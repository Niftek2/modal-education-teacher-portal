import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as thinkific from './lib/thinkificClient.js';

// Only unenroll from academic courses + Your Classroom; NOT from the Assignments course (3359727)
const UNENROLL_COURSE_IDS = new Set(['422595', '422618', '422620', '496294', '496295', '496297', '496298', '552235']);

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

        // Step 2: State-first — archive immediately so the UI unfreezes regardless of API outcome
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

        // Step 3: Concurrent unenrollment via Promise.allSettled — never freezes on a slow/failed API call
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
                if (failed > 0) console.warn(`[removeStudent] ${failed} unenrollment(s) failed — student archived, cleanup may be needed`);
            } catch (err) {
                console.warn(`[removeStudent] Could not fetch enrollments, skipping unenrollment: ${err.message}`);
            }
            console.log(`[removeStudent] Unenrolled ${unenrolled}/${targetCount} for ${studentEmail}`);
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