import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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

        // Mark matched assignments as completed (idempotent)
        const completedIds = [];
        for (const assignment of matchedAssignments) {
            if (assignment.completionEventId && assignment.completionEventId === webhookId) {
                console.log(`[markAssignmentComplete] Skipping ${assignment.id} — already processed webhook ${webhookId}`);
                continue;
            }
            const completedAt = event.occurredAt || new Date().toISOString();
            await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                status: 'completed',
                completedAt,
                completionEventId: webhookId,
                metadata: {
                    ...(assignment.metadata || {}),
                    grade: event.grade ?? null
                }
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