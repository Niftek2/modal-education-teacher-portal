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

        // lessonId is stored as an integer on ActivityEvent — normalize to string for matching
        const lessonId = event.lessonId ? String(event.lessonId) : null;
        const quizId = event.quizId ? String(event.quizId) : null;

        let matchedAssignments = [];

        if (event.eventType === 'quiz_attempted' || event.eventType === 'quiz.attempted') {
            // Match by lessonId (preferred) or quizId
            if (lessonId) {
                const byLesson = await base44.asServiceRole.entities.StudentAssignment.filter({
                    studentEmail: normalizedEmail,
                    lessonId,
                    status: 'assigned'
                });
                matchedAssignments.push(...byLesson);
            }
            if (quizId && matchedAssignments.length === 0) {
                const byQuiz = await base44.asServiceRole.entities.StudentAssignment.filter({
                    studentEmail: normalizedEmail,
                    quizId,
                    status: 'assigned'
                });
                matchedAssignments.push(...byQuiz);
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

        console.log(`[markAssignmentComplete] Event ${activityEventId}: email=${normalizedEmail}, lessonId=${lessonId}, matched=${matchedAssignments.length}`);

        // Mark matched assignments as completed
        const completedIds = [];
        for (const assignment of matchedAssignments) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                status: 'completed',
                completedAt: event.occurredAt,
                completedByEventId: event.id,
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