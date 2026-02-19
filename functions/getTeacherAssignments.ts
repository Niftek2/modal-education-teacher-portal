import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const t0 = Date.now();
    let t1, t2, t3, t4;

    let session;
    try {
        session = await requireSession(req);
    } catch (e) {
        return Response.json({ error: e.message }, { status: 401 });
    }

    if (!session) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email?.toLowerCase().trim();
        t1 = Date.now();

        const isTeacher = session.isTeacher === true || session.role === 'teacher';
        if (!isTeacher) {
            return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
        }

        const [studentCodes, archivedStudents, assignments, catalogItems] = await Promise.all([
            base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
            base44.asServiceRole.entities.ArchivedStudent.filter({}),
            base44.asServiceRole.entities.StudentAssignment.filter({ teacherEmail }),
            base44.asServiceRole.entities.AssignmentCatalog.list('title', 2000)
        ]);
        t2 = Date.now();

        const archivedEmailSet = new Set(
            (archivedStudents || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        const allEmails = (studentCodes || [])
            .map(s => s.studentEmail?.toLowerCase().trim())
            .filter(email => email && email.endsWith('@modalmath.com'));

        const activeEmails = allEmails.filter(e => !archivedEmailSet.has(e)).sort();
        const archivedEmails = allEmails.filter(e => archivedEmailSet.has(e)).sort();

        const roster = [
            ...activeEmails.map(email => ({ email, isArchived: false })),
            ...archivedEmails.map(email => ({ email, isArchived: true }))
        ];

        const activeCatalog = (catalogItems || []).filter(item => item.isActive !== false);
        t3 = Date.now();

        const sortedAssignments = (assignments || []).sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt));
        const studentsCount = roster?.length || 0;
        const catalogCount = activeCatalog?.length || 0;
        const assignmentsCount = sortedAssignments?.length || 0;
        const archivedStudentsCount = archivedStudents?.length || 0;
        t4 = Date.now();

        return Response.json({
            success: true,
            teacherEmail,
            students: roster,
            catalog: activeCatalog,
            assignments: (assignments || []).sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt)),
        });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});