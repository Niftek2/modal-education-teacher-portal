import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    let session = null;
    try {
        session = await requireSession(req);
    } catch (_) {
        // session remains null
    }

    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { studentEmails, catalogId, dueAt, assignPageOk, teacherEmail: bodyTeacherEmail } = body;

        // If session failed, only proceed if the request explicitly opts in via assignPageOk flag
        const assignPageHeader = req.headers.get('X-MM-Assign-Page') === '1';
        if (!session && !assignPageOk && !assignPageHeader) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Resolve teacherEmail: prefer session, fall back to body (validated below)
        const teacherEmail = session?.email || bodyTeacherEmail;

        // Strict input validation
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

        // Get teacher's groups — optional, don't fail if missing
        const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
        const groupId = (teacherGroups && teacherGroups.length > 0) ? teacherGroups[0].thinkificGroupId : null;

        const now = new Date().toISOString();

        // Create assignments
        const assignments = [];
        for (const studentEmail of studentEmails) {
            const normalizedEmail = studentEmail.trim().toLowerCase();
            
            // Only process @modalmath.com emails
            if (!normalizedEmail.endsWith('@modalmath.com')) {
                console.warn(`Skipping non-modalmath email: ${normalizedEmail}`);
                continue;
            }
            const dedupeKey = `assign:${normalizedEmail}:${catalogId}`;

            const assignment = {
                teacherEmail,
                groupId: groupId || '',
                studentEmail: normalizedEmail,
                catalogId,
                title: catalog.title,
                topic: catalog.topic || '',
                level: catalog.level || 'Elementary',
                type: catalog.type,
                courseId: catalog.courseId || '',
                lessonId: catalog.lessonId || '',
                quizId: catalog.quizId || '',
                thinkificUrl: catalog.thinkificUrl,
                assignedAt: now,
                dueAt: dueAt || null,
                status: 'assigned',
                dedupeKey
            };

            // Upsert: update if exists, create if not
            const existing2 = await base44.asServiceRole.entities.StudentAssignment.filter({ dedupeKey });
            let created;
            if (existing2 && existing2.length > 0) {
                created = await base44.asServiceRole.entities.StudentAssignment.update(existing2[0].id, {
                    dueAt: dueAt || null,
                    status: existing2[0].status === 'archived' ? 'assigned' : existing2[0].status
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