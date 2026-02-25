import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * No-auth student assignment lookup by email.
 * Returns all active (assigned + completed) assignments for the student.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        const rawEmail = body.studentEmail || body.email || '';
        const studentEmail = rawEmail.trim().toLowerCase();

        if (!studentEmail || !studentEmail.includes('@')) {
            return Response.json({ error: 'Valid studentEmail is required' }, { status: 400 });
        }

        const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
            studentEmail
        });

        // Return only assigned and completed (not archived)
        // Strip numeric-ID take URLs — client will resolve on demand
        function sanitizeUrl(url) {
            if (!url) return '';
            if (/\/courses\/take\/\d+\//.test(url)) return '';
            return url;
        }

        const active = (assignments || [])
            .filter(a => a.status !== 'archived')
            .sort((a, b) => {
                if (a.status === 'assigned' && b.status !== 'assigned') return -1;
                if (b.status === 'assigned' && a.status !== 'assigned') return 1;
                return new Date(b.assignedAt) - new Date(a.assignedAt);
            })
            .map(a => ({
                id: a.id,
                title: a.title,
                contentType: a.contentType || a.type,
                topic: a.topic || '',
                level: a.level || '',
                contentUrl: sanitizeUrl(a.contentUrl || a.thinkificUrl),
                // Pass through IDs so client can resolve URL if contentUrl is blank
                catalogId: a.catalogId || '',
                courseId: a.courseId || '',
                lessonId: a.lessonId || '',
                quizId: a.quizId || '',
                status: a.status,
                completedAt: a.completedAt || null,
                dueAt: a.dueAt || null,
                assignedAt: a.assignedAt
            }));

        return Response.json({ success: true, assignments: active });

    } catch (error) {
        console.error('[getStudentAssignmentsByEmail] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});