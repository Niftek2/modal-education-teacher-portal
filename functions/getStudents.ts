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

        const [groupUsersResult, archivedRecords, accessCodes] = await Promise.all([
            getGroupMembers(groupId).catch(err => {
                console.warn('[getStudents] Thinkific group API failed, will use DB only:', err.message);
                return null;
            }),
            base44.asServiceRole.entities.ArchivedStudent.filter({ teacherEmail }),
            base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
        ]);

        const archivedEmailSet = new Set(
            (archivedRecords || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        // Build a map of email → student from StudentAccessCode (DB source)
        const dbEmailSet = new Set(
            (accessCodes || [])
                .map(r => r.studentEmail?.toLowerCase().trim())
                .filter(e => e && e.endsWith('@modalmath.com'))
        );

        // Merge: start with DB students (no Thinkific profile data available)
        const mergedMap = new Map();
        for (const email of dbEmailSet) {
            mergedMap.set(email, { id: null, firstName: email.split('@')[0], lastName: '', email, password: 'Math1234!' });
        }

        if (groupUsersResult !== null) {
            // Filter group members to @modalmath.com + PK enrolled
            const modalMathUsers = groupUsersResult.filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'));
            const pkChecks = await Promise.all(modalMathUsers.map(u => isEnrolledInPK(u.id)));
            const pkUsers = modalMathUsers.filter((_, i) => pkChecks[i]);

            // Merge Thinkific data into map (overrides DB stubs with real names)
            for (const u of pkUsers) {
                const email = u.email.toLowerCase().trim();
                mergedMap.set(email, {
                    id: u.id,
                    firstName: u.first_name,
                    lastName: u.last_name,
                    email,
                    password: 'Math1234!',
                });
            }

            // Shadow-write: create StudentAccessCode for any Thinkific group member not in DB
            const shadowCreates = pkUsers
                .filter(u => !dbEmailSet.has(u.email.toLowerCase().trim()))
                .map(u => base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: u.email.toLowerCase().trim(),
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: teacherEmail,
                    groupId,
                }).catch(e => console.warn('[getStudents] Shadow create failed:', e.message)));
            if (shadowCreates.length > 0) {
                await Promise.all(shadowCreates);
                console.log(`[getStudents] Shadow-created ${shadowCreates.length} StudentAccessCode records`);
            }
        }

        const students = Array.from(mergedMap.values());

        return Response.json({
            activeStudents: students.filter(s => !archivedEmailSet.has(s.email)),
            archivedStudents: students.filter(s => archivedEmailSet.has(s.email)),
        });

    } catch (error) {
        console.error('Get students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});