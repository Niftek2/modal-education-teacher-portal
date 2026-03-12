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
        const { studentEmail: rawStudentEmail, groupId, teacherThinkificUserId, sessionToken } = body;

        // Derive teacherEmail from JWT session token (preferred) or fall back to body field
        let teacherEmail = body.teacherEmail?.toLowerCase().trim();
        if (sessionToken) {
            const session = await verifySessionToken(sessionToken);
            if (session?.email) {
                teacherEmail = session.email.toLowerCase().trim();
            }
        }

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

        // Step 3: Remove from Thinkific group via membership ID
        if (thinkificUser?.id && groupId) {
            try {
                const membership = await getGroupMembership(groupId, thinkificUser.id);
                if (membership?.id) {
                    const removed = await deleteGroupMembership(membership.id);
                    console.log(`[removeStudent] Group membership delete: ${removed ? '✓' : '✗'} (membership ${membership.id})`);
                } else {
                    console.log(`[removeStudent] No group membership found for user ${thinkificUser.id} in group ${groupId}`);
                }
            } catch (e) {
                console.warn(`[removeStudent] Group membership removal failed: ${e.message}`);
            }
        }

        // Step 4: Concurrent unenrollment via Promise.allSettled
        let unenrolled = 0;
        let targetCount = 0;
        if (thinkificUser?.id) {
            try {
                const enrollments = await getEnrollmentsForUser(thinkificUser.id);
                const targetEnrollments = enrollments.filter(e => UNENROLL_COURSE_IDS.has(String(e.course_id)));
                targetCount = targetEnrollments.length;
                console.log(`[removeStudent] Found ${targetCount} active target enrollments for ${studentEmail}`);

                const results = await Promise.allSettled(
                    targetEnrollments.map(enrollment =>
                        fetch(
                            `https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`,
                            { method: 'DELETE', headers: thinkificHeaders }
                        ).then(res => {
                            if (res.status === 204 || res.status === 404 || res.ok) {
                                console.log(`[removeStudent] ✓ Unenrolled course ${enrollment.course_id} (enrollment ${enrollment.id})`);
                                return true;
                            }
                            return res.text().then(body => {
                                console.warn(`[removeStudent] DELETE ${enrollment.id} → ${res.status}: ${body}`);
                                return false;
                            });
                        })
                    )
                );

                unenrolled = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
                const failed = results.filter(r => r.status === 'rejected' || r.value === false).length;
                if (failed > 0) console.warn(`[removeStudent] ${failed} unenrollment(s) failed`);
            } catch (err) {
                console.warn(`[removeStudent] Could not fetch enrollments: ${err.message}`);
            }
            console.log(`[removeStudent] Unenrolled ${unenrolled}/${targetCount} for ${studentEmail}`);
        }

        // Step 5: Delete StudentAccessCode record
        const accessCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail, createdByTeacherEmail: teacherEmail });
        await Promise.all(accessCodes.map(r => base44.asServiceRole.entities.StudentAccessCode.delete(r.id)));
        console.log(`[removeStudent] ✓ Deleted ${accessCodes.length} StudentAccessCode record(s) for ${studentEmail}`);

        return Response.json({ success: true, unenrolled, targetCount });

    } catch (error) {
        console.error('Remove student error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});