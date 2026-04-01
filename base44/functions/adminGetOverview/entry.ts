import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { jwtVerify } from 'npm:jose@5.9.6';

const ALLOWED_ADMINS = ['nadiajiftekhar@gmail.com', 'modalmath@gmail.com'];
const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';
const THINKIFIC_TOKEN = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');

async function requireAdminSession(req) {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;
    try {
        const secret = new TextEncoder().encode(Deno.env.get('JWT_SECRET'));
        const { payload } = await jwtVerify(token, secret);
        if (payload.type !== 'session') return null;
        if (!ALLOWED_ADMINS.includes(payload.email?.toLowerCase())) return null;
        return payload;
    } catch { return null; }
}

async function thinkificGet(path) {
    const res = await fetch(`${THINKIFIC_BASE}${path}`, {
        headers: { 'Authorization': `Bearer ${THINKIFIC_TOKEN}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    return res.json();
}

Deno.serve(async (req) => {
    try {
        const session = await requireAdminSession(req);
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const base44 = createClientFromRequest(req);

        // Fetch all data in parallel
        const [teacherGroups, accessCodes, archivedStudents] = await Promise.all([
            base44.asServiceRole.entities.TeacherGroup.list(),
            base44.asServiceRole.entities.StudentAccessCode.list(),
            base44.asServiceRole.entities.ArchivedStudent.list(),
        ]);

        // Group students by teacher email
        const studentsByTeacher = {};
        for (const code of accessCodes) {
            const email = code.createdByTeacherEmail?.toLowerCase().trim();
            if (!email) continue;
            if (!studentsByTeacher[email]) studentsByTeacher[email] = [];
            studentsByTeacher[email].push({
                email: code.studentEmail,
                createdAt: code.createdAt,
                status: 'active',
            });
        }
        for (const archived of archivedStudents) {
            const email = archived.teacherEmail?.toLowerCase().trim();
            if (!email) continue;
            if (!studentsByTeacher[email]) studentsByTeacher[email] = [];
            studentsByTeacher[email].push({
                email: archived.studentEmail,
                firstName: archived.studentFirstName,
                lastName: archived.studentLastName,
                thinkificUserId: archived.studentThinkificUserId,
                archivedAt: archived.archivedAt,
                status: 'archived',
            });
        }

        // Build teachers list from teacherGroups (deduplicated by email)
        const teacherMap = {};
        for (const tg of teacherGroups) {
            const email = tg.teacherEmail?.toLowerCase().trim();
            if (!email) continue;
            if (!teacherMap[email]) {
                teacherMap[email] = {
                    email,
                    thinkificUserId: tg.teacherThinkificUserId,
                    groups: [],
                };
            }
            teacherMap[email].groups.push({
                groupId: tg.thinkificGroupId,
                groupName: tg.thinkificGroupName,
            });
        }

        // Fetch Thinkific group members for each group in parallel
        const allGroupIds = [...new Set(teacherGroups.map(tg => tg.thinkificGroupId).filter(Boolean))];
        const groupMembersMap = {};
        await Promise.allSettled(allGroupIds.map(async (groupId) => {
            const data = await thinkificGet(`/users?query[group_id]=${groupId}&limit=100`);
            groupMembersMap[groupId] = (data?.items || [])
                .filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'))
                .map(u => ({
                    id: u.id,
                    email: u.email?.toLowerCase(),
                    firstName: u.first_name,
                    lastName: u.last_name,
                }));
        }));

        // Attach Thinkific group members to each teacher
        for (const teacher of Object.values(teacherMap)) {
            teacher.thinkificStudents = [];
            for (const g of teacher.groups) {
                const members = groupMembersMap[g.groupId] || [];
                teacher.thinkificStudents.push(...members.map(m => ({ ...m, groupId: g.groupId, groupName: g.groupName })));
            }
        }

        const teachers = Object.values(teacherMap).map(t => ({
            ...t,
            dbStudents: studentsByTeacher[t.email] || [],
        }));

        // Include teachers who have students but no TeacherGroup record
        for (const [email, students] of Object.entries(studentsByTeacher)) {
            if (!teacherMap[email]) {
                teachers.push({ email, groups: [], dbStudents: students, thinkificStudents: [] });
            }
        }

        return Response.json({ teachers });
    } catch (error) {
        console.error('adminGetOverview error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});