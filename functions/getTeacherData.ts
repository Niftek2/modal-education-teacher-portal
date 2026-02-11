import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized - no token provided');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

async function getTeacherGroups(userId) {
    // Get all groups
    const groupsResponse = await fetch(`https://api.thinkific.com/api/public/v1/groups`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    if (!groupsResponse.ok) {
        throw new Error('Failed to fetch groups');
    }
    
    const groupsData = await groupsResponse.json();
    const allGroups = groupsData.items || [];
    
    // Find which groups this teacher is a member of
    for (const group of allGroups) {
        const membersResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/group_memberships?query[group_id]=${group.id}`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (membersResponse.ok) {
            const membersData = await membersResponse.json();
            const isTeacherMember = membersData.items?.some(m => m.user_id === userId);
            if (isTeacherMember) {
                return group;
            }
        }
    }
    
    return null;
}

async function getThinkificUser(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        throw new Error('Failed to fetch user');
    }
    
    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const authHeader = req.headers.get('Authorization');
        const sessionToken = authHeader?.replace('Bearer ', '');
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