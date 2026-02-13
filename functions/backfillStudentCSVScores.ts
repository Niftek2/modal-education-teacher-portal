import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'Missing studentEmail' }, { status: 400 });
        }

        // Find all quiz_attempted from CSV for this student
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({
            studentEmail: studentEmail.toLowerCase(),
            eventType: 'quiz_attempted',
            source: 'rest_backfill'
        });

        let repaired = 0;
        const repairLog = [];

        for (const event of events) {
            // If scorePercent is missing or null, try to extract from rawPayload
            if (!Number.isFinite(event.scorePercent)) {
                try {
                    const payload = JSON.parse(event.rawPayload || '{}');
                    const scorePercent = payload['% Score'] ? Number(payload['% Score']) : null;

                    if (Number.isFinite(scorePercent)) {
                        await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                            scorePercent: scorePercent
                        });
                        repaired++;
                        repairLog.push({
                            quizName: event.contentTitle,
                            scorePercent: scorePercent,
                            occurredAt: event.occurredAt
                        });
                    }
                } catch (error) {
                    console.error(`Failed to repair event ${event.id}:`, error.message);
                }
            }
        }

        console.log(`[BACKFILL] Repaired ${repaired}/${events.length} records for ${studentEmail}`);

        return Response.json({
            studentEmail,
            scanned: events.length,
            repaired,
            repairLog
        });
    } catch (error) {
        console.error('[BACKFILL] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});