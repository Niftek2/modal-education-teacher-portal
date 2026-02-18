import { findUserByEmail, listEnrollments, deleteEnrollment } from './lib/thinkificClient.js';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    try {
        const session = await requireSession(req);

        const { createServiceRoleClient } = await import('npm:@base44/sdk@0.8.6');
        const base44 = createServiceRoleClient();

        const { studentEmail, groupId, teacherId } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        // Resolve student by email
        const found = await findUserByEmail(studentEmail);
        if (!found?.id) {
            return Response.json({ error: `Student not found for email: ${studentEmail}` }, { status: 404 });
        }

        const resolvedStudentId = found.id;
        console.log(`[REMOVE STUDENT] Resolved student ID: ${resolvedStudentId} for email: ${studentEmail}`);

        // Unenroll from all enrollments
        const enrollments = await listEnrollments({ 'query[user_id]': String(resolvedStudentId) });
        console.log(`[REMOVE STUDENT] Found ${enrollments.length} enrollments to remove`);

        for (const e of enrollments) {
            if (!e?.id) continue;
            await deleteEnrollment(e.id);
            console.log(`[REMOVE STUDENT] Deleted enrollment ${e.id}`);
        }

        console.log(`[REMOVE STUDENT] Unenrollment complete, now archiving`);

        // Archive the student record
        await base44.asServiceRole.entities.ArchivedStudent.create({
            studentThinkificUserId: String(resolvedStudentId),
            studentEmail: found.email,
            studentFirstName: found.first_name,
            studentLastName: found.last_name,
            teacherThinkificUserId: String(teacherId || session?.userId || 'unknown'),
            groupId: String(groupId || 'unknown'),
            archivedAt: new Date().toISOString()
        });

        console.log(`[REMOVE STUDENT] Archived student record`);

        return Response.json({
            success: true,
            resolvedStudentId,
            unenrolled: enrollments.length
        });

    } catch (error) {
        console.error('Remove student error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});