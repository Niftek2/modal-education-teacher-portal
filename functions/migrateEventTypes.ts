import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Fetch all events with dot-style eventTypes
        const quizEvents = await base44.asServiceRole.entities.ActivityEvent.filter({ 
            eventType: 'quiz.attempted' 
        });
        const lessonEvents = await base44.asServiceRole.entities.ActivityEvent.filter({ 
            eventType: 'lesson.completed' 
        });
        const signinEvents = await base44.asServiceRole.entities.ActivityEvent.filter({ 
            eventType: 'user.signin' 
        });

        let updated = 0;
        const errors = [];

        // Update quiz.attempted → quiz_attempted
        for (const event of quizEvents) {
            try {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    eventType: 'quiz_attempted'
                });
                updated++;
            } catch (error) {
                errors.push({ id: event.id, error: error.message });
            }
        }

        // Update lesson.completed → lesson_completed
        for (const event of lessonEvents) {
            try {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    eventType: 'lesson_completed'
                });
                updated++;
            } catch (error) {
                errors.push({ id: event.id, error: error.message });
            }
        }

        // Update user.signin → user_signin (keeping for consistency)
        for (const event of signinEvents) {
            try {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    eventType: 'user_signin'
                });
                updated++;
            } catch (error) {
                errors.push({ id: event.id, error: error.message });
            }
        }

        return Response.json({
            success: true,
            updated,
            summary: {
                quizEvents: quizEvents.length,
                lessonEvents: lessonEvents.length,
                signinEvents: signinEvents.length
            },
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});