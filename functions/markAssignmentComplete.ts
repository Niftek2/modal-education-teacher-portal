import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * This function should be called from webhook handler AFTER ActivityEvent is created.
 * It matches completed quizzes/lessons to student assignments and marks them complete.
 * 
 * Call this from your webhook handler like:
 * await base44.functions.invoke('markAssignmentComplete', { activityEventId: event.id })
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

        let matchedAssignments = [];

        // Match based on event type
        if (event.eventType === 'quiz_attempted' || event.eventType === 'quiz.attempted') {
            // Try to match by lessonId first (preferred), then quizId
            const lessonId = event.metadata?.lessonId || event.contentId;
            const quizId = event.metadata?.quizId || event.contentId;

            // Find assignments that match this student and lesson/quiz
            const assignmentsByLesson = lessonId ? await base44.asServiceRole.entities.StudentAssignment.filter({
                studentEmail: normalizedEmail,
                lessonId,
                status: 'assigned'
            }) : [];

            const assignmentsByQuiz = quizId ? await base44.asServiceRole.entities.StudentAssignment.filter({
                studentEmail: normalizedEmail,
                quizId,
                status: 'assigned'
            }) : [];

            matchedAssignments = [...assignmentsByLesson, ...assignmentsByQuiz];

        } else if (event.eventType === 'lesson_completed' || event.eventType === 'lesson.completed') {
            // Match by lessonId
            const lessonId = event.contentId || event.metadata?.lessonId;
            
            if (lessonId) {
                matchedAssignments = await base44.asServiceRole.entities.StudentAssignment.filter({
                    studentEmail: normalizedEmail,
                    lessonId,
                    status: 'assigned'
                });
            }
        }

        // Mark matched assignments as completed
        const completedIds = [];
        for (const assignment of matchedAssignments || []) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                status: 'completed',
                completedAt: event.occurredAt,
                completedByEventId: event.id
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