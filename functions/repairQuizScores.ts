import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Fetch all quiz_attempted events
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        
        const quizEvents = allEvents.filter(e => e.eventType === 'quiz_attempted');

        let repaired = 0;
        const repairLog = [];

        for (const event of quizEvents) {
            // Skip if scorePercent is already a finite number
            if (Number.isFinite(event.scorePercent)) {
                continue;
            }

            let scoreValue = null;

            // Try metadata fields first
            if (event.metadata?.grade != null) {
                const n = Number(event.metadata.grade);
                if (Number.isFinite(n)) {
                    scoreValue = n;
                }
            }
            if (scoreValue === null && event.metadata?.scorePercent != null) {
                const n = Number(event.metadata.scorePercent);
                if (Number.isFinite(n)) {
                    scoreValue = n;
                }
            }

            // Fallback: parse rawPayload for grade or scorePercent
            if (scoreValue === null && event.rawPayload) {
                try {
                    const payload = typeof event.rawPayload === 'string' 
                        ? JSON.parse(event.rawPayload) 
                        : event.rawPayload;
                    if (payload?.grade != null) {
                        const n = Number(payload.grade);
                        if (Number.isFinite(n)) {
                            scoreValue = n;
                        }
                    } else if (payload?.['% Score'] != null) {
                        const n = Number(payload['% Score']);
                        if (Number.isFinite(n)) {
                            scoreValue = n;
                        }
                    }
                } catch (err) {
                    // Ignore parse errors
                }
            }

            // If we found a valid score, update the event
            if (scoreValue !== null) {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    scorePercent: scoreValue
                });
                repaired++;
                repairLog.push({
                    id: event.id,
                    studentEmail: event.studentEmail,
                    quizName: event.contentTitle,
                    scorePercent: scoreValue
                });
            }
        }

        return Response.json({
            status: 'success',
            totalQuizEvents: quizEvents.length,
            eventsRepaired: repaired,
            repairLog: repairLog
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});