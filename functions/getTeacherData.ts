import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized - no token provided');
    }

    try {
        console.log('Verifying session token...');
        const secret = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret);
        console.log('Token verified. UserId:', payload.userId);
        return payload;
    } catch (err) {
        console.error('Token verification failed:', err.message);
        throw new Error('Invalid or expired session token');
    }
}

async function getTeacherGroups(userId) {
    try {
        // Fetch all groups first
        const groupsResponse = await fetch('https://api.thinkific.com/api/public/v1/groups', {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!groupsResponse.ok) {
            const errorText = await groupsResponse.text();
            throw new Error(`Failed to fetch groups: ${groupsResponse.status} - ${errorText}`);
        }
        
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.items || [];
        
        // For each group, check if this user is a member
        for (const group of allGroups) {
            const membershipsResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/group_memberships?query[group_id]=${group.id}`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            if (membershipsResponse.ok) {
                const membershipsData = await membershipsResponse.json();
                const members = membershipsData.items || [];
                
                // Check if userId is in this group
                const isMember = members.some(m => m.user_id === userId);
                if (isMember) {
                    return group;
                }
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('[getTeacherGroups] Error:', error.message);
        return null;
    }
}

async function getThinkificUser(userId) {
    console.log('Fetching Thinkific user:', userId);
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    console.log('Thinkific user response status:', response.status);
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Thinkific user fetch error:', response.status, errorText);
        throw new Error(`Failed to fetch user: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const { sessionToken } = await req.json();
        console.log('Session token received:', sessionToken ? 'Yes' : 'No');
        const session = await verifySession(sessionToken);
        
        // Get teacher user details
        const user = await getThinkificUser(session.userId);
        console.log('User fetched:', user.id, user.email);
        
        // Get teacher's group
        console.log('Fetching teacher groups...');
        const group = await getTeacherGroups(session.userId);
        console.log('Group result:', group);
        
        return Response.json({
            teacher: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email
            },
            group: group ? {
                id: group.id,
                name: group.name
            } : null
        });

    } catch (error) {
        console.error('Get teacher data error:', error);
        console.error('Stack:', error.stack);
        return Response.json({ error: error.message }, { status: 401 });
    }
});