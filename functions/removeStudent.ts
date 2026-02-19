import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

// Exact course IDs to unenroll from (PK through L5)
const COURSE_IDS_TO_UNENROLL = ['422595', '422618', '422620', '496294', '496295', '496297', '496298'];

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json'
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
    // 204 = success, 404 = already gone — both are fine
    return res.status === 204 || res.status === 404 || res.ok;
}

Deno.serve(async (req) => {
    try {
        const session = await requireSession(req);
        if (!session) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);
        const { studentEmail, groupId, teacherId } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        const normalizedEmail = studentEmail.toLowerCase().trim();

        // Step 1: Archive in DB (soft delete — do NOT remove StudentAccessCode)
        await base44.asServiceRole.entities.ArchivedStudent.create({
            studentEmail: normalizedEmail,
            groupId: String(groupId || 'unknown'),
            teacherThinkificUserId: String(teacherId || session?.userId || 'unknown'),
            archivedAt: new Date().toISOString()
        });

        console.log(`[removeStudent] Archived ${normalizedEmail} in DB`);

        // Step 2: Find Thinkific user
        const found = await findUserByEmail(normalizedEmail);
        if (!found?.id) {
            // Already archived in DB — that's fine, just warn
            console.warn(`[removeStudent] Thinkific user not found for ${normalizedEmail}`);
            return Response.json({ success: true, unenrolled: 0, note: 'Archived in DB; Thinkific user not found' });
        }

        const thinkificUserId = found.id;
        console.log(`[removeStudent] Found Thinkific user ${thinkificUserId} for ${normalizedEmail}`);

        // Step 3: Unenroll from PK–L5 courses only (keep group membership and account)
        const enrollments = await getEnrollmentsForUser(thinkificUserId);
        const targetEnrollments = enrollments.filter(e =>
            COURSE_IDS_TO_UNENROLL.includes(String(e.course_id))
        );

        console.log(`[removeStudent] Found ${targetEnrollments.length} target course enrollments to remove`);

        let unenrolled = 0;
        for (const e of targetEnrollments) {
            const ok = await deleteEnrollment(e.id);
            if (ok) {
                unenrolled++;
                console.log(`[removeStudent] Deleted enrollment ${e.id} (course ${e.course_id})`);
            }
        }

        return Response.json({ success: true, unenrolled });

    } catch (error) {
        console.error('Remove student error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});