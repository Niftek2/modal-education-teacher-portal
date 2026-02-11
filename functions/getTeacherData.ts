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
        console.log('[getTeacherGroups] Starting group lookup for userId:', userId);
        // Fetch all groups and check which ones have this user as a member
        const groupsResponse = await fetch('https://api.thinkific.com/api/public/v1/groups', {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[getTeacherGroups] Groups list response status:', groupsResponse.status);
        
        if (!groupsResponse.ok) {
            throw new Error(`Failed to fetch groups: ${groupsResponse.status}`);
        }
        
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.items || [];
        console.log('[getTeacherGroups] Found groups:', allGroups.map(g => ({ id: g.id, name: g.name })));
        
        // For each group, check if user is a member via Group Users endpoint
        for (const group of allGroups) {
            // Skip certain groups to speed up search
            if (!['Nadia TODHH', "Ms Nadia's Class", 'Nadia Classroom'].includes(group.name)) {
                continue;
            }
            
            console.log(`[getTeacherGroups] Checking group: ${group.name}`);
            const usersResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/groups/${group.id}/users`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log(`[getTeacherGroups] ${group.name} - Status: ${usersResponse.status}`);
            
            if (usersResponse.ok) {
                const usersData = await usersResponse.json();
                const users = usersData.items || [];
                console.log(`[getTeacherGroups] ${group.name} - ${users.length} users`);
                
                // Log all user IDs in the group
                console.log(`[getTeacherGroups] ${group.name} users:`, users.map(u => u.id).join(','));
                
                // Check if this user is in the group
                const isMember = users.some(u => u.id === userId);
                console.log(`[getTeacherGroups] User ${userId} in ${group.name}? ${isMember}`);
                
                if (isMember) {
                    console.log(`[getTeacherGroups] FOUND: User in ${group.name}`);
                    return group;
                }
            }
        }
        
        console.log(`[getTeacherGroups] User ${userId} not found in any group`);
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
        const session = await verifySession(sessionToken);
        
        // Get teacher user details
        const user = await getThinkificUser(session.userId);
        
        // Get teacher's group
        const group = await getTeacherGroups(session.userId);
        
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
        return Response.json({ error: error.message }, { status: 401 });
    }
});