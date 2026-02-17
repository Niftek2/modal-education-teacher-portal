import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const { studentEmail, limit = 200, skip = 0 } = body;
        
        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }
        
        // Normalize email
        const normalizedEmail = studentEmail.trim().toLowerCase();
        
        // Query ActivityEvent with pagination
        const events = await base44.asServiceRole.entities.ActivityEvent.filter(
            { studentEmail: normalizedEmail },
            '-occurredAt',
            limit,
            skip
        );
        
        // Calculate if there are more events
        const hasMore = events.length === limit;
        const nextSkip = hasMore ? skip + limit : null;
        
        return Response.json({
            events,
            nextSkip,
            hasMore,
            total: events.length
        });
    } catch (error) {
        console.error('Error fetching student events:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});