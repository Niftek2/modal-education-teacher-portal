import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const payload = await req.json();
        const studentEmail = payload?.studentEmail;

        if (!studentEmail) {
            return Response.json({ error: 'Missing studentEmail' }, { status: 400 });
        }

        // Get last 20 quiz attempts for this student
        const quizEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            studentEmail: studentEmail.toLowerCase(),
            eventType: 'quiz_attempted'
        });

        const sorted = quizEvents
            .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
            .slice(0, 20);

        const diagnostic = sorted.map(event => ({
            quizName: event.contentTitle,
            lessonId: event.contentId,
            courseName: event.courseName || '(empty)',
            occurredAt: event.occurredAt,
            resultId: event.metadata?.resultId,
            hasCourseMapping: !!(event.courseName && event.courseName.trim())
        }));

        return Response.json({
            studentEmail,
            totalScanned: sorted.length,
            withoutCourseName: sorted.filter(e => !e.courseName || !e.courseName.trim()).length,
            diagnostic
        });
    } catch (error) {
        console.error('[DIAGNOSTIC] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});