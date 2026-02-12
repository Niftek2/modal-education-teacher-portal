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
        const { limit = 50, sessionToken } = await req.json();
        await verifySession(sessionToken);

        const base44 = createClientFromRequest(req);

        // Get recent activity events
        const events = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', limit);

        return Response.json({
            events: events.map(event => ({
                id: event.id,
                studentEmail: event.studentEmail,
                studentDisplayName: event.studentDisplayName,
                courseName: event.courseName,
                eventType: event.eventType,
                contentTitle: event.contentTitle,
                occurredAt: event.occurredAt,
                source: event.source
            }))
        });

    } catch (error) {
        console.error('[GET RECENT ACTIVITY] Error:', error);
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});