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
    // Get all groups
    console.log('Looking for groups for user:', userId);
    const groupsResponse = await fetch(`https://api.thinkific.com/api/public/v1/groups`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    if (!groupsResponse.ok) {
        const errorText = await groupsResponse.text();
        console.error('Groups fetch error:', groupsResponse.status, errorText);
        throw new Error('Failed to fetch groups');
    }
    
    const groupsData = await groupsResponse.json();
    const allGroups = groupsData.items || [];
    console.log('Found groups:', allGroups.length);
    
    // Find which groups this teacher is a member of
    for (const group of allGroups) {
        console.log('Checking group:', group.id, group.name);
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
            console.log(`Group ${group.id} members:`, JSON.stringify(membersData.items || []));
            const isTeacherMember = membersData.items?.some(m => {
                console.log(`Comparing user_id: ${m.user_id} === ${userId}`, m.user_id === userId);
                return m.user_id === userId;
            });
            if (isTeacherMember) {
                console.log('Found teacher in group:', group.id);
                return group;
            }
        } else {
            console.log(`Failed to fetch members for group ${group.id}`);
        }
    }
    
    console.log('No groups found for teacher');
    return null;
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