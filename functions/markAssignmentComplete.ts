import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

/**
 * Called from ingestThinkificWebhook AFTER ActivityEvent is created.
 * Matches completed lessons/quizzes to pending StudentAssignment records
 * and marks them complete.
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { activityEventId } = await req.json();

        // Get the activity event
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({ id: activityEventId });
        if (!events || events.length === 0) {
            return Response.json({ error: 'Event not found' }, { status: 404 });
        }

        const event = events[0];
        const normalizedEmail = event.studentEmail?.trim().toLowerCase();

        if (!normalizedEmail) {
            return Response.json({ success: false, message: 'No student email in event' });
        }

        // Idempotency key: prefer webhookEventId, fall back to event.id
        const webhookId = event.webhookEventId || event.id || null;

        // lessonId stored as integer on ActivityEvent — normalize to string
        const lessonId = event.lessonId ? String(event.lessonId) : null;

        // quizId: try direct field first, then rawPayload
        let quizId = event.quizId ? String(event.quizId) : null;
        if (!quizId && event.rawPayload) {
            try {
                const raw = JSON.parse(event.rawPayload);
                const qId = raw?.payload?.quiz?.id;
                if (qId) quizId = String(qId);
            } catch (_) { /* ignore */ }
        }

        let matchedAssignments = [];

        if (event.eventType === 'quiz_attempted' || event.eventType === 'quiz.attempted') {
            // Match by quizId first, fall back to lessonId
            if (quizId) {
                const byQuiz = await base44.asServiceRole.entities.StudentAssignment.filter({
                    studentEmail: normalizedEmail,
                    quizId,
                    status: 'assigned'
                });
                matchedAssignments.push(...byQuiz);
            }
            if (lessonId && matchedAssignments.length === 0) {
                const byLesson = await base44.asServiceRole.entities.StudentAssignment.filter({
                    studentEmail: normalizedEmail,
                    lessonId,
                    status: 'assigned'
                });
                matchedAssignments.push(...byLesson);
            }

        } else if (event.eventType === 'lesson_completed' || event.eventType === 'lesson.completed') {
            if (lessonId) {
                matchedAssignments = await base44.asServiceRole.entities.StudentAssignment.filter({
                    studentEmail: normalizedEmail,
                    lessonId,
                    status: 'assigned'
                });
            }
        }

        console.log(`[markAssignmentComplete] Event ${activityEventId}: email=${normalizedEmail}, lessonId=${lessonId}, quizId=${quizId}, matched=${matchedAssignments.length}`);

        // Compute score from ActivityEvent
        let incomingScore = null;
        if (typeof event.grade === 'number') {
            const raw = event.grade;
            incomingScore = Math.min(100, Math.max(0, Math.round((raw > 0 && raw < 1) ? raw * 100 : raw)));
        }

        const cc = typeof event.correctCount === 'number' ? event.correctCount : null;
        const ic = typeof event.incorrectCount === 'number' ? event.incorrectCount : null;
        const totalQuestions = (cc !== null && ic !== null) ? cc + ic : null;

        // Mark matched assignments as completed (idempotent)
        const completedIds = [];
        for (const assignment of matchedAssignments) {
            if (assignment.completionEventId && assignment.completionEventId === webhookId) {
                console.log(`[markAssignmentComplete] Skipping ${assignment.id} — already processed webhook ${webhookId}`);
                continue;
            }
            const completedAt = event.occurredAt || new Date().toISOString();

            // Idempotency: don't regress a later completion
            const existingCompleted = assignment.completedAt;
            const useCompletedAt = (existingCompleted && new Date(existingCompleted) > new Date(completedAt))
                ? existingCompleted
                : completedAt;

            // Don't regress score if already set from a later event
            const updateScore = incomingScore !== null;

            await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                status: 'completed',
                completedAt: useCompletedAt,
                completionEventId: webhookId,
                ...(updateScore ? {
                    score: incomingScore,
                    metadata: {
                        ...(assignment.metadata || {}),
                        grade: event.grade ?? null,
                        correctCount: cc,
                        totalQuestions
                    }
                } : {}),
            });
            completedIds.push(assignment.id);
            console.log(`[markAssignmentComplete] Completed assignment ${assignment.id} for ${normalizedEmail} at ${completedAt}`);
        }

        return Response.json({
            success: true,
            matched: completedIds.length,
            completedAssignments: completedIds
        });

    } catch (error) {
        console.error('Mark assignment complete error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});