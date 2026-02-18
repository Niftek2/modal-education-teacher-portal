import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'Email is required' }, { status: 400 });
        }

        const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
            studentEmail: studentEmail.toLowerCase().trim(),
            status: { $ne: 'archived' }
        });

        const sorted = (assignments || []).sort((a, b) =>
            new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime()
        );

        return Response.json({ success: true, assignments: sorted });

    } catch (error) {
        console.error('Get student assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});