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

async function getTeacherGroup(userId) {
    try {
        console.log('Fetching group memberships for user:', userId);
        const membershipsResponse = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Group memberships response status:', membershipsResponse.status);
        const membershipsData = await membershipsResponse.json();
        console.log('Group memberships data:', JSON.stringify(membershipsData, null, 2));
        
        const memberships = membershipsData.items || [];
        console.log('Found memberships count:', memberships.length);
        
        // Get the first group the teacher is in
        if (memberships.length > 0) {
            console.log('Returning group:', memberships[0].group);
            return memberships[0].group;
        }
        
        console.log('No group found, returning null');
        return null;
        
    } catch (error) {
        console.error('getTeacherGroup error:', error.message);
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
        
        // Get teacher's group (using their user ID)
        const group = await getTeacherGroup(session.userId);
        
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