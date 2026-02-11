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
    // Get all group memberships for this user
    console.log('Looking for groups for user:', userId);
    
    try {
        const membershipsResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('Memberships response status:', membershipsResponse.status);
        
        if (!membershipsResponse.ok) {
            const errorText = await membershipsResponse.text();
            console.error('Group memberships fetch error:', membershipsResponse.status, errorText);
            return null;
        }
    } catch (err) {
        console.error('Error fetching memberships:', err.message);
        return null;
    }
    
    const membershipsData = await membershipsResponse.json();
    const memberships = membershipsData.items || [];
    console.log('Found memberships:', memberships.length);
    
    if (memberships.length === 0) {
        console.log('User has no group memberships');
        return null;
    }
    
    // Get the first group ID from memberships
    const groupId = memberships[0].group_id;
    console.log('User is member of group:', groupId);
    
    // Fetch the group details
    const groupResponse = await fetch(
        `https://api.thinkific.com/api/public/v1/groups/${groupId}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        }
    );
    
    if (!groupResponse.ok) {
        const errorText = await groupResponse.text();
        console.error('Group fetch error:', groupResponse.status, errorText);
        return null;
    }
    
    const group = await groupResponse.json();
    console.log('Found group:', group.id, group.name);
    return group;
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