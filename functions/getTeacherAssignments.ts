import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!session.isTeacher && session.role !== 'teacher') {
        return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email;

        const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
            teacherEmail
        });

        const sorted = (assignments || []).sort((a, b) =>
            new Date(b.assignedAt) - new Date(a.assignedAt)
        );

        return Response.json({ success: true, assignments: sorted });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});