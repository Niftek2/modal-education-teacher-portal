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
        const { studentEmail, groupId } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        const normalizedEmail = studentEmail.toLowerCase().trim();

        // Derive teacher identity from session only — never from request body
        const teacherThinkificUserId = String(session.userId || session.thinkificUserId || 'unknown');
        const resolvedGroupId = String(groupId || 'unknown');

        // Step 1: Find Thinkific user by email
        let found = null;
        try {
            found = await findUserByEmail(normalizedEmail);
        } catch (e) {
            console.warn(`[removeStudent] Could not look up Thinkific user: ${e.message}`);
        }

        const studentThinkificUserId = found?.id ? String(found.id) : 'unknown';
        console.log(`[removeStudent] Thinkific user for ${normalizedEmail}: ${studentThinkificUserId}`);

        // Step 2: Archive in DB — idempotent (skip if already archived for this teacher)
        const existing = await base44.asServiceRole.entities.ArchivedStudent.filter({
            studentEmail: normalizedEmail,
            teacherThinkificUserId
        });

        if (existing.length === 0) {
            await base44.asServiceRole.entities.ArchivedStudent.create({
                studentThinkificUserId,
                studentEmail: normalizedEmail,
                studentFirstName: found?.first_name || '',
                studentLastName: found?.last_name || '',
                teacherThinkificUserId,
                groupId: resolvedGroupId,
                archivedAt: new Date().toISOString()
            });
            console.log(`[removeStudent] Archived ${normalizedEmail} in DB`);
        } else {
            console.log(`[removeStudent] Already archived in DB, skipping create`);
        }

        // Step 3: If user not found in Thinkific, return early
        if (!found?.id) {
            console.warn(`[removeStudent] Thinkific user not found for ${normalizedEmail}`);
            return Response.json({ success: true, unenrolled: 0, note: 'Archived in DB; Thinkific user not found' });
        }

        // Step 4: Unenroll from PK–L5 courses only (keep group membership and account)
        const enrollments = await getEnrollmentsForUser(found.id);
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