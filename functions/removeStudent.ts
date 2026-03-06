import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

// Only unenroll from academic courses + Your Classroom; NOT from the Assignments course (3359727)
const UNENROLL_COURSE_IDS = new Set(['422595', '422618', '422620', '496294', '496295', '496297', '496298', '552235']);

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
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
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&limit=250`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to fetch enrollments: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentEmail: rawStudentEmail, teacherEmail: rawTeacherEmail } = await req.json();

        const studentEmail = rawStudentEmail?.toLowerCase().trim();
        const teacherEmail = rawTeacherEmail?.toLowerCase().trim();

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

        // Step 2: Fetch enrollments and unenroll from allowed courses one-by-one (with per-item try/catch)
        let unenrolled = 0;
        let targetCount = 0;
        if (thinkificUser?.id) {
            try {
                const enrollments = await getEnrollmentsForUser(thinkificUser.id);
                const targetEnrollments = enrollments.filter(e => UNENROLL_COURSE_IDS.has(String(e.course_id)));
                targetCount = targetEnrollments.length;
                console.log(`[removeStudent] Found ${targetCount} target enrollments for ${studentEmail}`);

                for (const enrollment of targetEnrollments) {
                    try {
                        const res = await fetch(
                            `https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`,
                            { method: 'DELETE', headers: thinkificHeaders }
                        );
                        if (res.status === 204 || res.status === 404 || res.ok) {
                            unenrolled++;
                            console.log(`[removeStudent] ✓ Unenrolled from course ${enrollment.course_id} (enrollment ${enrollment.id})`);
                        } else {
                            const body = await res.text();
                            console.warn(`[removeStudent] DELETE enrollment ${enrollment.id} returned ${res.status}: ${body}`);
                        }
                    } catch (err) {
                        // Log and continue — do not freeze on one failure
                        console.warn(`[removeStudent] Unenrollment failed for enrollment ${enrollment.id} (course ${enrollment.course_id}): ${err.message}`);
                    }
                }
            } catch (err) {
                console.warn(`[removeStudent] Could not fetch enrollments, skipping unenrollment: ${err.message}`);
            }
            console.log(`[removeStudent] Unenrolled ${unenrolled}/${targetCount} for ${studentEmail}`);
        }

        // Step 3: Archive in DB — AFTER unenrollment loop finishes
        const existing = await base44.asServiceRole.entities.ArchivedStudent.filter({ studentEmail, teacherEmail });
        if (existing.length === 0) {
            await base44.asServiceRole.entities.ArchivedStudent.create({
                studentThinkificUserId: thinkificUser?.id ? String(thinkificUser.id) : 'unknown',
                studentEmail,
                studentFirstName: thinkificUser?.first_name || '',
                studentLastName: thinkificUser?.last_name || '',
                teacherEmail,
                teacherThinkificUserId: 'unknown',
                groupId: 'unknown',
                archivedAt: new Date().toISOString(),
            });
            console.log(`[removeStudent] ✓ Archived ${studentEmail}`);
        }

        // Step 4: Delete StudentAccessCode record — final cleanup
        const accessCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail, createdByTeacherEmail: teacherEmail });
        await Promise.all(accessCodes.map(r => base44.asServiceRole.entities.StudentAccessCode.delete(r.id)));
        console.log(`[removeStudent] ✓ Deleted ${accessCodes.length} StudentAccessCode record(s) for ${studentEmail}`);

        return Response.json({ success: true, unenrolled, targetCount });

    } catch (error) {
        console.error('Remove student error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});