import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Called from ingestThinkificWebhook AFTER ActivityEvent is created.
 * Matches completed lessons/quizzes to pending StudentAssignment records
 * and marks them complete.
 * 
 * ActivityEvent fields used: studentEmail, lessonId, eventType
 * StudentAssignment fields matched: studentEmail + lessonId (or quizId)
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

        const webhookId = event.webhookEventId || null;

        // lessonId is stored as an integer on ActivityEvent — normalize to string for matching
        const lessonId = event.lessonId ? String(event.lessonId) : null;
        // For quiz events, ActivityEvent stores quizId via the quiz.id from payload
        // It is stored in the rawPayload; also try lessonId as quiz lessons share the lessonId field
        let quizId = null;
        if (event.rawPayload) {
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

        // Mark matched assignments as completed (idempotent: skip if already completed or same webhookId)
        const completedIds = [];
        for (const assignment of matchedAssignments) {
            // Idempotency: skip if already completed or this webhook already applied
            if (assignment.completionEventId && assignment.completionEventId === webhookId) {
                console.log(`[markAssignmentComplete] Skipping ${assignment.id} — already processed webhook ${webhookId}`);
                continue;
            }
            await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                status: 'completed',
                completedAt: event.occurredAt,
                completedByEventId: event.id,
                completionEventId: webhookId,
                metadata: {
                    ...(assignment.metadata || {}),
                    grade: event.grade ?? null
                }
            });
            completedIds.push(assignment.id);
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