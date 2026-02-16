import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * ONE-TIME MIGRATION: Backfill quiz_attempted events with null grades
 * Parses rawPayload to extract grade, lessonName, attemptNumber, correctCount, incorrectCount
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Fetch all quiz_attempted events with null grade
        const nullGradeEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'quiz_attempted',
            grade: null
        });

        console.log(`[BACKFILL] Found ${nullGradeEvents.length} quiz events with null grade`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const event of nullGradeEvents) {
            try {
                if (!event.rawPayload) {
                    console.log(`[BACKFILL] Skipping event ${event.id}: no rawPayload`);
                    skipped++;
                    continue;
                }

                const parsed = JSON.parse(event.rawPayload);
                const payload = parsed.payload || {};
                const quiz = payload.quiz || {};

                // Extract fields
                const grade = payload.grade;
                const quizName = quiz.name;
                const attemptNumber = payload.attempts;
                const correctCount = payload.correct_count;
                const incorrectCount = payload.incorrect_count;

                // Normalize grade to percentage
                let gradePercent = null;
                if (typeof grade === 'number') {
                    gradePercent = grade <= 1 ? grade * 100 : grade;
                }

                // Update the event
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    grade: gradePercent,
                    lessonName: quizName || event.lessonName,
                    attemptNumber: attemptNumber || event.attemptNumber,
                    correctCount: correctCount !== undefined ? correctCount : event.correctCount,
                    incorrectCount: incorrectCount !== undefined ? incorrectCount : event.incorrectCount
                });

                console.log(`[BACKFILL] ✓ Updated event ${event.id}: grade=${gradePercent}%, name="${quizName}"`);
                updated++;
            } catch (error) {
                console.error(`[BACKFILL] Error updating event ${event.id}:`, error.message);
                errors++;
            }
        }

        return Response.json({
            success: true,
            summary: {
                total: nullGradeEvents.length,
                updated,
                skipped,
                errors
            }
        });
    } catch (error) {
        console.error('[BACKFILL] Fatal error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});