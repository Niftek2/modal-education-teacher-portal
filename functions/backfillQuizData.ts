import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Backfill missing quiz data from raw payloads
 * Extracts grade, lessonName, attemptNumber, correctCount, incorrectCount
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        console.log('[BACKFILL] Starting quiz data backfill...');

        // Fetch all quiz_attempted events with null grade
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'quiz_attempted',
            grade: null
        });

        console.log(`[BACKFILL] Found ${events.length} quiz attempts with missing grade`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const event of events) {
            try {
                if (!event.rawPayload) {
                    console.log(`[BACKFILL] Skipping ${event.id}: no rawPayload`);
                    skipped++;
                    continue;
                }

                // Parse raw payload
                const rawData = JSON.parse(event.rawPayload);
                
                // Handle both formats: direct payload or wrapper with payload property
                const payload = rawData.payload || rawData;

                // Extract fields
                const grade = payload.grade;
                const quizName = payload.quiz?.name;
                const attemptNumber = payload.attempts;
                const correctCount = payload.correct_count;
                const incorrectCount = payload.incorrect_count;

                // Check if we have anything to update
                if (grade == null && !quizName) {
                    console.log(`[BACKFILL] Skipping ${event.id}: no data in payload`);
                    skipped++;
                    continue;
                }

                // Normalize grade to percentage
                let gradePercent = null;
                if (typeof grade === 'number') {
                    gradePercent = grade <= 1 ? grade * 100 : grade;
                }

                // Build update object
                const updates = {};
                if (gradePercent != null) updates.grade = gradePercent;
                if (quizName) updates.lessonName = quizName;
                if (attemptNumber != null) updates.attemptNumber = attemptNumber;
                if (correctCount != null) updates.correctCount = correctCount;
                if (incorrectCount != null) updates.incorrectCount = incorrectCount;

                // Update the record
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, updates);
                
                console.log(`[BACKFILL] ✓ Updated ${event.id}: ${quizName || 'Unknown'} - ${gradePercent}%`);
                updated++;

            } catch (error) {
                console.error(`[BACKFILL] Error updating ${event.id}:`, error.message);
                errors++;
            }
        }

        const summary = {
            total: events.length,
            updated,
            skipped,
            errors,
            message: `Backfill complete: ${updated} updated, ${skipped} skipped, ${errors} errors`
        };

        console.log('[BACKFILL] Summary:', summary);
        return Response.json(summary, { status: 200 });

    } catch (error) {
        console.error('[BACKFILL] Fatal error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});