import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireTeacherSession } from './lib/auth.js';
import * as thinkific from './lib/thinkificClient.js';

async function getTeacherGroups(teacherEmail, teacherId) {
    try {
        const normalizedEmail = (teacherEmail || '').toLowerCase().trim();
        const allGroups = await thinkific.listGroups();
        const teacherGroups = [];
        
        for (const group of allGroups) {
            try {
                const groupUsers = await thinkific.listGroupUsers(group.id);
                const isMember = groupUsers.some(u => {
                    if (normalizedEmail && (u.email || '').toLowerCase().trim() === normalizedEmail) return true;
                    if (teacherId && String(u.id) === String(teacherId)) return true;
                    return false;
                });
                
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
        return [];
    }
}

Deno.serve(async (req) => {
    const session = await requireTeacherSession(req);

    if (!session) {
        return Response.json({ error: "Invalid teacher session" }, { status: 401 });
    }

    try {
        const teacherEmail = session.email;
        
        // Resolve Thinkific user by email (session has teacher email, not Thinkific ID)
        const found = await thinkific.findUserByEmail(teacherEmail);
        const user = found || { email: teacherEmail, first_name: '', last_name: '', id: null };
        
        // Get teacher's groups by email
        const groups = await getTeacherGroups(teacherEmail, user.id);
        
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