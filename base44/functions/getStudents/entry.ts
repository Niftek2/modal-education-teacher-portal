import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
};

async function getGroupIdForTeacher(teacherEmail, base44) {
    const records = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
    return records?.[0]?.thinkificGroupId || null;
}

const PK_COURSE_ID = Deno.env.get('PK_COURSE_ID');

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

        const [groupUsersResult, archivedRecords, accessCodes, studentProfiles] = await Promise.all([
            getGroupMembers(groupId).catch(err => {
                console.warn('[getStudents] Thinkific group API failed, will use DB only:', err.message);
                return null;
            }),
            base44.asServiceRole.entities.ArchivedStudent.filter({ teacherEmail }),
            base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
            base44.asServiceRole.entities.StudentProfile.list('-lastSeenAt', 2000).catch(() => []),
        ]);

        // Build email → level map from StudentProfile
        const levelByEmail = new Map();
        for (const p of (studentProfiles || [])) {
            const e = p.email?.toLowerCase().trim();
            if (e && p.level) levelByEmail.set(e, p.level);
        }

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
            mergedMap.set(email, { id: null, firstName: email.split('@')[0], lastName: '', email, password: 'Math1234!', level: levelByEmail.get(email) || null });
        }

        if (groupUsersResult !== null) {
            // Filter group members to @modalmath.com only — they are students by definition
            const pkUsers = groupUsersResult.filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'));

            // Merge Thinkific data into map — always overwrites DB stubs so id is never null for synced students
            for (const u of pkUsers) {
                const email = u.email.toLowerCase().trim();
                const prev = mergedMap.get(email);
                if (prev && !prev.id) {
                    console.log(`[getStudents] Upgrading DB stub for ${email}: id null → ${u.id}`);
                }
                mergedMap.set(email, {
                    id: u.id,
                    firstName: u.first_name,
                    lastName: u.last_name,
                    email,
                    password: 'Math1234!',
                    level: levelByEmail.get(email) || null,
                });
            }

            // Shadow-write: create StudentAccessCode for any Thinkific group member not in DB
            // Then immediately link: log how many existing ActivityEvents already exist for that email
            // Shadow-sync: create DB record for any Thinkific member not yet in DB (direct upsert, no pre-check)
            const newStudents = pkUsers.filter(u => !dbEmailSet.has(u.email.toLowerCase().trim()));
            if (newStudents.length > 0) {
                await Promise.allSettled(newStudents.map(async (u) => {
                    const email = u.email.toLowerCase().trim();
                    try {
                        await base44.asServiceRole.entities.StudentAccessCode.create({
                            studentEmail: email,
                            createdAt: new Date().toISOString(),
                            createdByTeacherEmail: teacherEmail,
                            groupId,
                        });
                        console.log(`[getStudents] Shadow-synced ${email} → DB`);
                    } catch (e) {
                        // Duplicate key = already exists, safe to ignore
                        console.warn(`[getStudents] Shadow-sync skipped for ${email}: ${e.message}`);
                    }
                }));
                console.log(`[getStudents] Shadow-sync attempted for ${newStudents.length} student(s)`);
            }
        }

        const students = Array.from(mergedMap.values());

        // Archived students come directly from ArchivedStudent records (not from mergedMap,
        // since their StudentAccessCode is deleted on removal)
        const archivedStudentsList = (archivedRecords || []).map(r => ({
            id: r.studentThinkificUserId || null,
            firstName: r.studentFirstName || r.studentEmail?.split('@')[0] || '',
            lastName: r.studentLastName || '',
            email: r.studentEmail,
            password: 'Math1234!',
            archivedAt: r.archivedAt,
        }));

        return Response.json({
            activeStudents: students.filter(s => !archivedEmailSet.has(s.email)),
            archivedStudents: archivedStudentsList,
        });

    } catch (error) {
        console.error('Get students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});