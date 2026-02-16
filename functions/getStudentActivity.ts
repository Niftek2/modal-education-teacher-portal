import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'Student email required' }, { status: 400 });
        }

        const base44 = createClientFromRequest(req);

        // Get all activity events for this student
        const events = await base44.asServiceRole.entities.ActivityEvent.filter(
            { studentEmail },
            '-occurredAt',
            100
        );

        // Format for display
        const formattedEvents = events.map(event => {
            const metadata = typeof event.metadata === 'string' 
                ? JSON.parse(event.metadata) 
                : (event.metadata || {});

            return {
                id: event.id,
                type: event.eventType,
                courseName: event.courseName,
                contentTitle: event.contentTitle,
                occurredAt: event.occurredAt,
                source: event.source,
                score: metadata.score,
                percentage: metadata.percentage,
                percentageCompleted: metadata.percentageCompleted
            };
        });

        return Response.json({
            student: studentEmail,
            totalEvents: formattedEvents.length,
            events: formattedEvents
        });

    } catch (error) {
        console.error('[GET ACTIVITY] Error:', error);
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});