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
    console.log('START getTeacherGroups for:', userId);
    try {
        // Find Nadia TODHH group specifically
        const groupsResponse = await fetch('https://api.thinkific.com/api/public/v1/groups', {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        const groupsData = await groupsResponse.json();
        const nadiaGroup = groupsData.items?.find(g => g.name === 'Nadia TODHH');
        console.log('Nadia TODHH group:', nadiaGroup?.id);
        
        if (!nadiaGroup) {
            console.log('Nadia TODHH group not found');
            return null;
        }
        
        // Check both group_members and instructors
        const [membersResp, instructorsResp] = await Promise.all([
            fetch(
                `https://api.thinkific.com/api/public/v1/group_members?query[group_id]=${nadiaGroup.id}`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                        'Content-Type': 'application/json'
                    }
                }
            ),
            fetch(
                `https://api.thinkific.com/api/public/v1/group_instructors?query[group_id]=${nadiaGroup.id}`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                        'Content-Type': 'application/json'
                    }
                }
            )
        ]);
        
        const membersData = await membersResp.json();
        const instructorsData = await instructorsResp.json();
        
        const members = membersData.items || [];
        const instructors = instructorsData.items || [];
        
        console.log('Members:', members.map(u => u.user_id).join(','));
        console.log('Instructors:', instructors.map(u => u.user_id).join(','));
        
        const isMember = members.some(u => u.user_id === userId);
        const isInstructor = instructors.some(u => u.user_id === userId);
        
        console.log('Is member?', isMember, 'Is instructor?', isInstructor);
        
        return (isMember || isInstructor) ? nadiaGroup : null;
        
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