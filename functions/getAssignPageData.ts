import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

/**
 * Returns the teacher's student roster from StudentAccessCode table.
 * Uses createdByTeacherEmail to identify teacher-owned students.
 * Much more reliable than Thinkific Group API calls.
 */
Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session || (!session.isTeacher && session.role !== 'teacher')) {
        return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email?.toLowerCase().trim();

        console.log(`[getAssignPageData] Fetching roster for teacher: ${teacherEmail}`);

        // Get all students created by this teacher
        const studentCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({
            createdByTeacherEmail: teacherEmail
        });

        // Get archived students to exclude from active roster
        const archivedStudents = await base44.asServiceRole.entities.ArchivedStudent.filter({});
        const archivedEmailSet = new Set(
            archivedStudents.map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        // Filter: only @modalmath.com, only active (not archived)
        const studentEmails = (studentCodes || [])
            .map(s => s.studentEmail?.toLowerCase().trim())
            .filter(email => email && email.endsWith('@modalmath.com') && !archivedEmailSet.has(email))
            .sort();

        console.log(`[getAssignPageData] Found ${studentEmails.length} active students for ${teacherEmail}`);

        return Response.json({ success: true, studentEmails }, { status: 200 });

    } catch (error) {
        console.error('[getAssignPageData] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});