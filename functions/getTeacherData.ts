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
        console.log('[getTeacherGroups] Looking for groups for user:', userId);
        
        // Query group_memberships for this user
        const url = `https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}`;
        console.log('[getTeacherGroups] Fetching from:', url);
        
        const membershipsResponse = await fetch(url, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[getTeacherGroups] Response status:', membershipsResponse.status);
        
        if (!membershipsResponse.ok) {
            const errorText = await membershipsResponse.text();
            throw new Error(`API error ${membershipsResponse.status}: ${errorText}`);
        }
        
        const membershipsData = await membershipsResponse.json();
        console.log('[getTeacherGroups] Response data:', JSON.stringify(membershipsData).substring(0, 500));
        
        const memberships = membershipsData.items || [];
        console.log('[getTeacherGroups] Found memberships count:', memberships.length);
        
        if (memberships.length === 0) {
            console.log('[getTeacherGroups] User has no group memberships');
            return null;
        }
        
        // Get the first group ID from memberships
        const groupId = memberships[0].group_id;
        console.log('[getTeacherGroups] User is member of group ID:', groupId);
        
        // Fetch the full group details
        const groupUrl = `https://api.thinkific.com/api/public/v1/groups/${groupId}`;
        console.log('[getTeacherGroups] Fetching group from:', groupUrl);
        
        const groupResponse = await fetch(groupUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[getTeacherGroups] Group response status:', groupResponse.status);
        
        if (!groupResponse.ok) {
            const errorText = await groupResponse.text();
            throw new Error(`Failed to fetch group: ${groupResponse.status} - ${errorText}`);
        }
        
        const group = await groupResponse.json();
        console.log('[getTeacherGroups] Found group:', group.id, group.name);
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