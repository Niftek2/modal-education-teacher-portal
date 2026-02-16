import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);

        console.log('[BACKFILL] Starting quiz score backfill...');

        // Get all quiz_attempted events with missing or invalid scorePercent
        const allQuizEvents = await base44.asServiceRole.entities.ActivityEvent.filter({ 
            eventType: 'quiz_attempted' 
        });

        const needsBackfill = allQuizEvents.filter(evt => {
            const score = evt.metadata?.scorePercent;
            return score === null || score === undefined || Number.isNaN(score);
        });

        console.log(`[BACKFILL] Found ${needsBackfill.length} events needing backfill out of ${allQuizEvents.length} total`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const evt of needsBackfill) {
            try {
                // Try to get raw webhook payload
                const webhookEvents = evt.rawEventId 
                    ? await base44.asServiceRole.entities.WebhookEvent.filter({ webhookId: evt.rawEventId })
                    : [];

                if (webhookEvents.length === 0) {
                    console.log(`[BACKFILL] No webhook payload found for event ${evt.id}, skipping`);
                    skipped++;
                    continue;
                }

                const webhookPayload = JSON.parse(webhookEvents[0].payloadJson);
                const payload = webhookPayload.payload;

                // Re-extract score data with proper numeric conversion - use null if missing
                const gradePercent = payload?.grade != null ? Number(payload.grade) : null;
                const correctCount = payload?.correct_count != null ? Number(payload.correct_count) : null;
                const incorrectCount = payload?.incorrect_count != null ? Number(payload.incorrect_count) : null;
                const attemptNumber = payload?.attempts != null ? Number(payload.attempts) : null;
                const resultId = payload?.result_id;
                
                const questionCount = (Number.isFinite(correctCount) ? correctCount : 0) + (Number.isFinite(incorrectCount) ? incorrectCount : 0);

                // Derive scorePercent with exact priority
                let scorePercent = null;
                if (Number.isFinite(gradePercent)) {
                    scorePercent = gradePercent;
                } else if (questionCount > 0 && Number.isFinite(correctCount)) {
                    scorePercent = Math.round((correctCount / questionCount) * 100);
                }

                // Update the event with proper dedupe key if resultId available
                const newDedupeKey = resultId ? `quiz_attempted:${resultId}` : evt.dedupeKey;
                
                await base44.asServiceRole.entities.ActivityEvent.update(evt.id, {
                    dedupeKey: newDedupeKey,
                    metadata: {
                        ...evt.metadata,
                        gradePercent: gradePercent,
                        correctCount: correctCount,
                        incorrectCount: incorrectCount,
                        questionCount: questionCount,
                        attempts: attemptNumber,
                        resultId: resultId ? String(resultId) : null,
                        scorePercent: scorePercent
                    }
                });

                console.log(`[BACKFILL] Updated event ${evt.id}: scorePercent=${scorePercent}`);
                updated++;
            } catch (error) {
                console.error(`[BACKFILL] Failed to backfill event ${evt.id}:`, error);
                errors++;
            }
        }

        const summary = {
            total: allQuizEvents.length,
            needsBackfill: needsBackfill.length,
            updated,
            skipped,
            errors
        };

        console.log('[BACKFILL] Complete:', summary);

        return Response.json({
            success: true,
            summary
        });
    } catch (error) {
        console.error('[BACKFILL] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});