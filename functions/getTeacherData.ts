import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import * as thinkific from './lib/thinkificClient.js';

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
        // Use Thinkific SDK to fetch all groups
        const allGroups = await thinkific.listGroups();
        const teacherGroups = [];
        
        for (const group of allGroups) {
            try {
                const groupUsers = await thinkific.listGroupUsers(group.id);
                const isMember = groupUsers.some(u => String(u.id) === String(userId));
                
                if (isMember) {
                    teacherGroups.push(group);
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

Deno.serve(async (req) => {
    try {
        const { sessionToken } = await req.json();
        const session = await verifySession(sessionToken);
        
        // Get teacher user details using Thinkific SDK
        const user = await thinkific.getUser(session.userId);
        
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