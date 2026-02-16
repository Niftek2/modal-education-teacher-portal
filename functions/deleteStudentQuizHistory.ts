import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin function to delete quiz history for a specific student
 * Used before re-importing corrected CSV data
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { studentEmail, source } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        const normalizedEmail = studentEmail.trim().toLowerCase();

        // Build filter
        const filter = {
            studentEmail: normalizedEmail,
            eventType: 'quiz_attempted'
        };

        // If source specified, filter by it
        if (source) {
            filter.source = source;
        }

        // Fetch all matching events
        const events = await base44.asServiceRole.entities.ActivityEvent.filter(
            filter,
            null,
            5000
        );

        // Delete them
        let deleted = 0;
        for (const event of events) {
            await base44.asServiceRole.entities.ActivityEvent.delete(event.id);
            deleted++;
        }

        return Response.json({
            success: true,
            studentEmail: normalizedEmail,
            deleted,
            filter: source ? `source="${source}"` : 'all sources'
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});