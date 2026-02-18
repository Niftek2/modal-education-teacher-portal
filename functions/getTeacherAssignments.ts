import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireTeacherSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireTeacherSession(req);

    if (!session) {
        return Response.json({ error: "Invalid teacher session" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email;

        // Get all assignments for this teacher
        const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
            teacherEmail
        });

        // Sort by assigned date (newest first)
        const sorted = (assignments || []).sort((a, b) => 
            new Date(b.assignedAt) - new Date(a.assignedAt)
        );

        return Response.json({
            success: true,
            assignments: sorted
        });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});