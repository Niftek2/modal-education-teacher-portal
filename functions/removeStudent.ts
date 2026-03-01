import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

const ALL_COURSE_IDS = ['3359727', '422595', '422618', '422620', '496294', '496295', '496297', '496298'];

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
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&limit=100`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to fetch enrollments: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

async function deleteEnrollment(enrollmentId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments/${enrollmentId}`,
        { method: 'DELETE', headers: thinkificHeaders }
    );
    return res.status === 204 || res.status === 404 || res.ok;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentEmail: rawStudentEmail, teacherEmail: rawTeacherEmail } = await req.json();

        const studentEmail = rawStudentEmail?.toLowerCase().trim();
        const teacherEmail = rawTeacherEmail?.toLowerCase().trim();

        if (!studentEmail) return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        if (!teacherEmail) return Response.json({ error: 'teacherEmail is required' }, { status: 400 });

        // Look up Thinkific user (non-fatal if not found)
        let thinkificUser = null;
        try {
            thinkificUser = await findUserByEmail(studentEmail);
        } catch (e) {
            console.warn(`[removeStudent] Thinkific lookup failed: ${e.message}`);
        }

        // Archive in DB — idempotent
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
            console.log(`[removeStudent] Archived ${studentEmail}`);
        }

        if (!thinkificUser?.id) {
            return Response.json({ success: true, unenrolled: 0, note: 'Archived in DB; Thinkific user not found' });
        }

        // Unenroll from all 8 courses (non-blocking — archive already complete)
        let unenrolled = 0;
        let targetCount = 0;
        try {
            const enrollments = await getEnrollmentsForUser(thinkificUser.id);
            const targetEnrollments = enrollments.filter(e => ALL_COURSE_IDS.includes(String(e.course_id)));
            targetCount = targetEnrollments.length;
            for (const enrollment of targetEnrollments) {
                try {
                    const ok = await deleteEnrollment(enrollment.id);
                    if (ok) unenrolled++;
                } catch (err) {
                    console.warn(`[removeStudent] Unenrollment failed for enrollment ${enrollment.id}:`, err.message);
                }
            }
        } catch (err) {
            console.warn(`[removeStudent] Could not fetch enrollments, skipping unenrollment:`, err.message);
        }

        console.log(`[removeStudent] Unenrolled ${unenrolled}/${targetCount} courses for ${studentEmail}`);
        return Response.json({ success: true, unenrolled });

    } catch (error) {
        console.error('Remove student error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});