import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { studentEmail } = body;
        
        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        // Normalize the email
        const normalizedEmail = studentEmail.toLowerCase().trim();
        
        // Fetch all events for this student with pagination
        const pageSize = 200;
        let allEvents = [];
        let skip = 0;
        let hasMore = true;
        
        while (hasMore) {
            const events = await base44.asServiceRole.entities.ActivityEvent.filter(
                { studentEmail: normalizedEmail },
                '-occurredAt',
                pageSize,
                skip
            );
            
            if (events.length === 0) {
                hasMore = false;
            } else {
                allEvents = allEvents.concat(events);
                skip += events.length;
                
                // Safety limit: stop after 2000 events
                if (allEvents.length >= 2000) {
                    hasMore = false;
                }
            }
        }
        
        // Deduplicate by dedupeKey
        const seenKeys = new Set();
        const uniqueEvents = [];
        
        for (const event of allEvents) {
            const key = event.dedupeKey || `${event.eventType}-${event.studentEmail}-${event.occurredAt}-${event.lessonName || ''}-${event.attemptNumber || ''}`;
            
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueEvents.push(event);
            }
        }
        
        return Response.json({
            studentEmail: normalizedEmail,
            totalEvents: uniqueEvents.length,
            events: uniqueEvents
        }, { status: 200 });
        
    } catch (error) {
        console.error('[GET STUDENT EVENTS] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});