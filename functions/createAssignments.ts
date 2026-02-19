import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { studentEmails, catalogId, dueAt, teacherEmail: bodyTeacherEmail } = body;

        // Resolve teacherEmail from body
        const teacherEmail = bodyTeacherEmail;

        // Input validation
        if (!teacherEmail || typeof teacherEmail !== 'string' || !teacherEmail.includes('@')) {
            return Response.json({ error: 'Invalid or missing teacherEmail' }, { status: 400 });
        }
        if (!Array.isArray(studentEmails) || studentEmails.length === 0) {
            return Response.json({ error: 'studentEmails must be a non-empty array' }, { status: 400 });
        }
        if (!catalogId || typeof catalogId !== 'string') {
            return Response.json({ error: 'Invalid or missing catalogId' }, { status: 400 });
        }
        if (dueAt !== undefined && dueAt !== null && isNaN(Date.parse(dueAt))) {
            return Response.json({ error: 'Invalid dueAt date' }, { status: 400 });
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

        // Normalize contentType
        const normalizedContentType = String(catalog.contentType || catalog.type || '').toLowerCase();

        // Get teacher's groups — optional
        const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
        const groupId = (teacherGroups && teacherGroups.length > 0) ? teacherGroups[0].thinkificGroupId : null;

        const now = new Date().toISOString();

        const lessonIdStr = catalog.thinkificLessonId ? String(catalog.thinkificLessonId) : (catalog.lessonId || '');
        const quizIdStr = catalog.thinkificQuizId ? String(catalog.thinkificQuizId) : (catalog.quizId || '');
        const contentUrl = catalog.contentUrl || catalog.thinkificUrl || '';

        // Create assignments
        const assignments = [];
        for (const studentEmail of studentEmails) {
            const normalizedEmail = studentEmail.trim().toLowerCase();

            // Dedupe key includes sourceKey (or catalogId fallback) + due date
            const dueKey = dueAt ? new Date(dueAt).toISOString().slice(0, 10) : 'none';
            const keyPart = catalog.sourceKey ? catalog.sourceKey : `catalog:${catalogId}`;
            const dedupeKey = `assign:${normalizedEmail}:${keyPart}:${dueKey}`;

            const assignment = {
                teacherEmail,
                groupId: groupId || '',
                studentEmail: normalizedEmail,
                catalogId,
                sourceKey: catalog.sourceKey || '',
                title: catalog.title,
                topic: catalog.topic || '',
                level: catalog.level || 'Elementary',
                type: normalizedContentType,
                contentType: normalizedContentType,
                courseId: catalog.courseId || '',
                lessonId: lessonIdStr,
                quizId: quizIdStr,
                thinkificUrl: contentUrl,
                contentUrl,
                assignedAt: now,
                dueAt: dueAt || null,
                status: 'assigned',
                dedupeKey
            };

            // Upsert: update if exists, create if not
            const existing = await base44.asServiceRole.entities.StudentAssignment.filter({ dedupeKey });
            let created;
            if (existing && existing.length > 0) {
                created = await base44.asServiceRole.entities.StudentAssignment.update(existing[0].id, {
                    dueAt: dueAt || null,
                    status: existing[0].status === 'archived' ? 'assigned' : existing[0].status,
                    title: catalog.title,
                    topic: catalog.topic || '',
                    level: catalog.level || 'Elementary',
                    sourceKey: catalog.sourceKey || '',
                    contentUrl,
                    thinkificUrl: contentUrl,
                    type: normalizedContentType,
                    contentType: normalizedContentType,
                    lessonId: lessonIdStr,
                    quizId: quizIdStr,
                    courseId: catalog.courseId || ''
                });
            } else {
                created = await base44.asServiceRole.entities.StudentAssignment.create(assignment);
            }
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