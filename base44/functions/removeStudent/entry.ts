import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

// Only unenroll from academic courses + Your Classroom; NOT from the Assignments course (3359727)
const UNENROLL_COURSE_IDS = new Set(['422595', '422618', '422620', '496294', '496295', '496297', '496298', '552235']);

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
};

async function findUserByEmail(email) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to find user: ${res.status}`);
    const data = await res.json();
    return data.items?.[0] || null;
}

async function getEnrollmentsForUser(userId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[status]=active&limit=250`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to fetch enrollments: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

async function getGroupMembership(groupId, userId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/group_users?query[group_id]=${groupId}&query[user_id]=${userId}`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items || [];
    return items.length > 0 ? items[0] : null;
}

async function deleteGroupMembership(membershipId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/group_users/${membershipId}`,
        { method: 'DELETE', headers: thinkificHeaders }
    );
    return res.ok || res.status === 404;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { studentEmail: rawStudentEmail, groupId, teacherThinkificUserId } = body;

        const teacherEmail = body.teacherEmail?.toLowerCase().trim();

        const studentEmail = rawStudentEmail?.toLowerCase().trim();

        if (!studentEmail) return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        if (!teacherEmail) return Response.json({ error: 'teacherEmail is required' }, { status: 400 });
        if (!studentEmail.endsWith('@modalmath.com')) return Response.json({ error: 'Only @modalmath.com students can be removed' }, { status: 400 });

        // Step 1: Look up Thinkific user ID by email
        let thinkificUser = null;
        try {
            thinkificUser = await findUserByEmail(studentEmail);
            console.log(`[removeStudent] Thinkific user lookup: ${thinkificUser ? `id=${thinkificUser.id}` : 'not found'}`);
        } catch (e) {
            console.warn(`[removeStudent] Thinkific lookup failed: ${e.message}`);
        }

        // Step 2: State-first — archive immediately so the UI unfreezes regardless of API outcome
        const existing = await base44.asServiceRole.entities.ArchivedStudent.filter({ studentEmail, teacherEmail });
        if (existing.length === 0) {
            await base44.asServiceRole.entities.ArchivedStudent.create({
                studentThinkificUserId: thinkificUser?.id ? String(thinkificUser.id) : 'unknown',
                studentEmail,
                studentFirstName: thinkificUser?.first_name || '',
                studentLastName: thinkificUser?.last_name || '',
                teacherEmail,
                teacherThinkificUserId: teacherThinkificUserId ? String(teacherThinkificUserId) : 'unknown',
                groupId: groupId ? String(groupId) : 'unknown',
                archivedAt: new Date().toISOString(),
            });
            console.log(`[removeStudent] ✓ Archived ${studentEmail}`);
        }

        // Step 3: Delete StudentAccessCode record (do this before returning so UI updates immediately)
        const accessCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail, createdByTeacherEmail: teacherEmail });
        await Promise.all(accessCodes.map(r => base44.asServiceRole.entities.StudentAccessCode.delete(r.id)));
        console.log(`[removeStudent] ✓ Deleted ${accessCodes.length} StudentAccessCode record(s) for ${studentEmail}`);

        // Step 4: Queue Thinkific unenrollment as a scheduled job (runs within ~15 min)
        const dedupeKey = `unenroll_student:${studentEmail}`;
        const existingJob = await base44.asServiceRole.entities.ScheduledUnenrollment.filter({ dedupeKey });
        if (existingJob.length === 0) {
            await base44.asServiceRole.entities.ScheduledUnenrollment.create({
                dedupeKey,
                jobType: 'student',
                teacherEmail,
                studentEmail,
                studentThinkificUserId: thinkificUser?.id ? String(thinkificUser.id) : null,
                runAt: new Date().toISOString(),
                status: 'scheduled',
            });
            console.log(`[removeStudent] ✓ Queued unenrollment job for ${studentEmail}`);
        }

        return Response.json({ success: true });

    } catch (error) {
        console.error('Remove student error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});