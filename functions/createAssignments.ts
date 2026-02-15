import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jwtVerify } from 'npm:jose@5.9.6';

const JWT_SECRET = Deno.env.get('JWT_SECRET');

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sessionToken, studentEmails, catalogId, dueAt } = await req.json();

        // Verify teacher session
        const session = await verifySession(sessionToken);
        const teacherEmail = session.email;

        if (!teacherEmail || !teacherEmail.endsWith('@modalmath.com')) {
            return Response.json({ error: 'Invalid teacher session' }, { status: 401 });
        }

        // Get catalog item
        const catalogItems = await base44.asServiceRole.entities.AssignmentCatalog.filter({ id: catalogId });
        if (!catalogItems || catalogItems.length === 0) {
            return Response.json({ error: 'Assignment not found' }, { status: 404 });
        }

        const catalog = catalogItems[0];
        if (!catalog.isActive) {
            return Response.json({ error: 'Assignment is not active' }, { status: 400 });
        }

        // Get teacher's groups (reuse existing logic pattern)
        const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
        if (!teacherGroups || teacherGroups.length === 0) {
            return Response.json({ error: 'No groups found for teacher' }, { status: 404 });
        }

        const groupId = teacherGroups[0].thinkificGroupId;
        const now = new Date().toISOString();
        const assignedDay = now.split('T')[0];

        // Create assignments
        const assignments = [];
        for (const studentEmail of studentEmails) {
            const normalizedEmail = studentEmail.trim().toLowerCase();
            const dedupeKey = `assign:${teacherEmail}:${normalizedEmail}:${catalogId}:${assignedDay}`;

            // Check for existing assignment
            const existing = await base44.asServiceRole.entities.StudentAssignment.filter({ dedupeKey });
            if (existing && existing.length > 0) {
                continue; // Skip duplicates
            }

            const assignment = {
                teacherEmail,
                groupId,
                studentEmail: normalizedEmail,
                catalogId,
                title: catalog.title,
                level: catalog.level || 'Elementary',
                type: catalog.type,
                courseId: catalog.courseId,
                lessonId: catalog.lessonId,
                quizId: catalog.quizId,
                thinkificUrl: catalog.thinkificUrl,
                assignedAt: now,
                dueAt: dueAt || null,
                status: 'assigned',
                dedupeKey
            };

            const created = await base44.asServiceRole.entities.StudentAssignment.create(assignment);
            assignments.push(created);
        }

        return Response.json({
            success: true,
            assigned: assignments.length,
            assignments
        });

    } catch (error) {
        console.error('Create assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});