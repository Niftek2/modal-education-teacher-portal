import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
};

async function getGroupMembers(groupId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[group_id]=${groupId}&limit=100`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to fetch group members: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId, teacherEmail: rawTeacherEmail } = await req.json();

        const teacherEmail = rawTeacherEmail?.toLowerCase().trim();

        if (!groupId) return Response.json({ error: 'groupId is required' }, { status: 400 });
        if (!teacherEmail) return Response.json({ error: 'teacherEmail is required' }, { status: 400 });

        const [groupUsers, archivedRecords] = await Promise.all([
            getGroupMembers(groupId),
            base44.asServiceRole.entities.ArchivedStudent.filter({ teacherEmail }),
        ]);

        const archivedEmailSet = new Set(
            (archivedRecords || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        const students = groupUsers
            .filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'))
            .map(u => ({
                id: u.id,
                firstName: u.first_name,
                lastName: u.last_name,
                email: u.email?.toLowerCase().trim(),
                password: 'Math1234!',
            }));

        const activeStudents = students.filter(s => !archivedEmailSet.has(s.email));
        const archivedStudents = students.filter(s => archivedEmailSet.has(s.email));

        return Response.json({ activeStudents, archivedStudents });

    } catch (error) {
        console.error('Get students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});