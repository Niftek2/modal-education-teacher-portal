import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
};

async function getGroupIdForTeacher(teacherEmail, base44) {
    const records = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
    return records?.[0]?.thinkificGroupId || null;
}

const PK_COURSE_ID = '422595';

async function getGroupMembers(groupId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[group_id]=${groupId}&limit=100`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to fetch group members: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

async function isEnrolledInPK(userId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${PK_COURSE_ID}&limit=1`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return (data.items?.length || 0) > 0;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { teacherEmail: rawTeacherEmail, groupId: providedGroupId } = await req.json();

        const teacherEmail = rawTeacherEmail?.toLowerCase().trim();
        if (!teacherEmail) return Response.json({ error: 'teacherEmail is required' }, { status: 400 });

        // Resolve groupId from TeacherGroup if not provided
        const groupId = providedGroupId || await getGroupIdForTeacher(teacherEmail, base44);
        if (!groupId) return Response.json({ error: 'No groupId found for this teacher' }, { status: 400 });

        const [groupUsers, archivedRecords] = await Promise.all([
            getGroupMembers(groupId),
            base44.asServiceRole.entities.ArchivedStudent.filter({ teacherEmail }),
        ]);

        const archivedEmailSet = new Set(
            (archivedRecords || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        // Roster = Thinkific group members with @modalmath.com email enrolled in PK (422595)
        const modalMathUsers = groupUsers.filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'));

        // Check PK enrollment in parallel for all candidates
        const pkChecks = await Promise.all(modalMathUsers.map(u => isEnrolledInPK(u.id)));

        const students = modalMathUsers
            .filter((_, i) => pkChecks[i])
            .map(u => ({
                id: u.id,
                firstName: u.first_name,
                lastName: u.last_name,
                email: u.email?.toLowerCase().trim(),
                password: 'Math1234!',
            }));

        return Response.json({
            activeStudents: students.filter(s => !archivedEmailSet.has(s.email)),
            archivedStudents: students.filter(s => archivedEmailSet.has(s.email)),
        });

    } catch (error) {
        console.error('Get students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});