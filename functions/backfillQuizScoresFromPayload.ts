import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Fetch all quiz attempts (both event type formats)
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const quizEvents = allEvents.filter(e => 
            e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted'
        );

        let updated = 0;
        let skipped = 0;
        let errors = [];

        for (const event of quizEvents) {
            try {
                // Parse rawPayload to extract score data
                const payload = JSON.parse(event.rawPayload || '{}');
                const grade = payload?.grade;
                
                // Skip if no grade in payload
                if (grade == null) {
                    skipped++;
                    continue;
                }

                // Extract fields from payload
                const scorePercent = Number(grade);
                const correctCount = payload?.correct_count != null ? Number(payload.correct_count) : null;
                const incorrectCount = payload?.incorrect_count != null ? Number(payload.incorrect_count) : null;
                const attemptNumber = payload?.attempts != null ? Number(payload.attempts) : null;
                const resultId = payload?.result_id ? String(payload.result_id) : null;

                // Update metadata with correct field names
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    metadata: {
                        scorePercent: scorePercent,
                        correctCount: correctCount,
                        incorrectCount: incorrectCount,
                        attemptNumber: attemptNumber,
                        resultId: resultId
                    }
                });

                updated++;
            } catch (error) {
                errors.push({ id: event.id, error: error.message });
            }
        }

        return Response.json({
            success: true,
            total: quizEvents.length,
            updated,
            skipped,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});