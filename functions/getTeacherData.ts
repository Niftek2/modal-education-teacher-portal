import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';
import * as thinkific from './lib/thinkificClient.js';

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
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        
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