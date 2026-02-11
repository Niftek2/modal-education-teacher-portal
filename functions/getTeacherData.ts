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
        // Fetch group memberships for this user
        const url = `https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}`;
        console.log('[getTeacherGroups] Fetching memberships from:', url);
        
        const membershipsResponse = await fetch(url, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[getTeacherGroups] Memberships response status:', membershipsResponse.status);
        
        if (!membershipsResponse.ok) {
            const errorText = await membershipsResponse.text();
            console.log('[getTeacherGroups] Error response:', errorText);
            throw new Error(`Failed to fetch memberships: ${membershipsResponse.status} - ${errorText}`);
        }
        
        const membershipsData = await membershipsResponse.json();
        console.log('[getTeacherGroups] Memberships data:', membershipsData);
        
        const memberships = membershipsData.items || [];
        console.log('[getTeacherGroups] Found memberships:', memberships.length);
        
        if (memberships.length === 0) {
            return null;
        }
        
        // Get the first membership's group_id
        const groupId = memberships[0].group_id;
        console.log('[getTeacherGroups] Group ID:', groupId);
        
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
        
        console.log('[getTeacherGroups] Group response status:', groupResponse.status);
        
        if (!groupResponse.ok) {
            const errorText = await groupResponse.text();
            throw new Error(`Failed to fetch group: ${groupResponse.status} - ${errorText}`);
        }
        
        const group = await groupResponse.json();
        console.log('[getTeacherGroups] Found group:', group);
        return group;
        
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