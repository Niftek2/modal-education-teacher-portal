import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) throw new Error('Unauthorized');
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

Deno.serve(async (req) => {
    try {
        const { studentEmail, sessionToken } = await req.json();
        
        await verifySession(sessionToken);

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