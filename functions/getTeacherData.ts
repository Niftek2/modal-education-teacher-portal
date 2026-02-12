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
        // Get all groups where this teacher is a member
        const groupsResponse = await fetch(`https://api.thinkific.com/api/public/v1/groups`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!groupsResponse.ok) {
            throw new Error(`Failed to fetch groups: ${groupsResponse.status}`);
        }
        
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.items || [];
        
        // Filter to groups where userId is a member
        const teacherGroups = [];
        for (const group of allGroups) {
            try {
                const membersResponse = await fetch(`https://api.thinkific.com/api/public/v1/users?query[group_id]=${group.id}`, {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (membersResponse.ok) {
                    const membersData = await membersResponse.json();
                    const members = membersData.items || [];
                    const isMember = members.some(m => String(m.id) === String(userId));
                    
                    if (isMember) {
                        teacherGroups.push(group);
                    }
                }
            } catch (err) {
                console.error(`Failed to check group membership for ${group.id}:`, err.message);
            }
        }
        
        return teacherGroups;
        
    } catch (error) {
        console.error('getTeacherGroups error:', error.message);
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
        
        // Get teacher's groups (plural - all groups, not filtered to one)
        const groups = await getTeacherGroups(session.userId);
        
        return Response.json({
            teacher: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email
            },
            groups: groups.map(g => ({
                id: g.id,
                name: g.name
            }))
        });

    } catch (error) {
        console.error('Get teacher data error:', error);
        return Response.json({ error: error.message }, { status: 401 });
    }
});