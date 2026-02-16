import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * ONE-TIME MIGRATION: Backfill quiz_attempted events with null grades
 * SAFETY: Only updates grade, lessonName, attemptNumber, correctCount, incorrectCount
 * Does NOT modify thinkificUserId or courseId
 */

const BATCH_SIZE = 25;
const DELAY_MS = 200;
const MAX_RETRIES = 5;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateWithRetry(base44, eventId, updateData, retries = 0) {
    try {
        await base44.asServiceRole.entities.ActivityEvent.update(eventId, updateData);
        return { success: true };
    } catch (error) {
        if (error.message?.includes('Rate limit') && retries < MAX_RETRIES) {
            const backoffDelay = Math.pow(2, retries) * 1000;
            console.log(`[BACKFILL] Rate limited, retrying in ${backoffDelay}ms (attempt ${retries + 1})`);
            await sleep(backoffDelay);
            return updateWithRetry(base44, eventId, updateData, retries + 1);
        }
        throw error;
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Fetch only quiz_attempted events with null grade AND rawPayload exists
        const nullGradeEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'quiz_attempted',
            grade: null
        });

        // Filter for events that have rawPayload
        const validEvents = nullGradeEvents.filter(e => e.rawPayload);
        console.log(`[BACKFILL] Found ${validEvents.length} quiz events with null grade and rawPayload (${nullGradeEvents.length} total)`);

        let updated = 0;
        let skipped = 0;
        const errorCounts = new Map();

        // Process in batches
        for (let i = 0; i < validEvents.length; i += BATCH_SIZE) {
            const batch = validEvents.slice(i, i + BATCH_SIZE);
            console.log(`[BACKFILL] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(validEvents.length / BATCH_SIZE)}`);

            for (const event of batch) {
                try {
                    const parsed = JSON.parse(event.rawPayload);
                    const payload = parsed.payload || parsed;
                    const quiz = payload.quiz || {};

                    // Extract fields from rawPayload
                    const rawGrade = payload.grade;
                    const rawQuizName = quiz.name;
                    const rawAttemptNumber = payload.attempts;
                    const rawCorrectCount = payload.correct_count;
                    const rawIncorrectCount = payload.incorrect_count;

                    // Build update object ONLY for fields that are currently null
                    const updateData = {};
                    let hasUpdates = false;

                    // Grade: normalize to percentage, safe conversion
                    if (event.grade == null && rawGrade != null) {
                        const numGrade = Number(rawGrade);
                        if (!isNaN(numGrade)) {
                            updateData.grade = numGrade <= 1 ? numGrade * 100 : numGrade;
                            hasUpdates = true;
                        }
                    }

                    // Lesson name
                    if (event.lessonName == null && rawQuizName) {
                        updateData.lessonName = rawQuizName;
                        hasUpdates = true;
                    }

                    // Attempt number: safe conversion
                    if (event.attemptNumber == null && rawAttemptNumber != null) {
                        const numAttempt = Number(rawAttemptNumber);
                        if (!isNaN(numAttempt)) {
                            updateData.attemptNumber = numAttempt;
                            hasUpdates = true;
                        }
                    }

                    // Correct count: safe conversion
                    if (event.correctCount == null && rawCorrectCount != null) {
                        const numCorrect = Number(rawCorrectCount);
                        if (!isNaN(numCorrect)) {
                            updateData.correctCount = numCorrect;
                            hasUpdates = true;
                        }
                    }

                    // Incorrect count: safe conversion
                    if (event.incorrectCount == null && rawIncorrectCount != null) {
                        const numIncorrect = Number(rawIncorrectCount);
                        if (!isNaN(numIncorrect)) {
                            updateData.incorrectCount = numIncorrect;
                            hasUpdates = true;
                        }
                    }

                    if (!hasUpdates) {
                        console.log(`[BACKFILL] Skipping event ${event.id}: no null fields to update`);
                        skipped++;
                        continue;
                    }

                    // Update with retry logic
                    await updateWithRetry(base44, event.id, updateData);
                    
                    console.log(`[BACKFILL] ✓ Updated event ${event.id}: ${JSON.stringify(updateData)}`);
                    updated++;
                } catch (error) {
                    const errorMsg = error.message || 'Unknown error';
                    errorCounts.set(errorMsg, (errorCounts.get(errorMsg) || 0) + 1);
                    console.error(`[BACKFILL] Error updating event ${event.id}:`, errorMsg);
                }
            }

            // Delay between batches to avoid rate limits
            if (i + BATCH_SIZE < validEvents.length) {
                await sleep(DELAY_MS);
            }
        }

        // Get top 3 errors
        const topErrors = Array.from(errorCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([msg, count]) => `${msg} (${count} times)`);

        const totalErrors = Array.from(errorCounts.values()).reduce((sum, count) => sum + count, 0);

        return Response.json({
            success: true,
            summary: {
                matched: validEvents.length,
                updated,
                skipped,
                errors: totalErrors,
                topErrors: topErrors.length > 0 ? topErrors : ['No errors']
            }
        });
    } catch (error) {
        console.error('[BACKFILL] Fatal error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});