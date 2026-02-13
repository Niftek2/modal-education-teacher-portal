import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail required' }, { status: 400 });
        }

        // Fetch quiz attempts with both event type formats
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        
        const quizEvents = allEvents.filter(e => 
            e.eventType === 'quiz_attempted' &&
            e.studentEmail?.toLowerCase() === studentEmail.toLowerCase()
        ).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 20);

        const diagnostic = quizEvents.map(event => ({
            id: event.id,
            eventType: event.eventType,
            resulId: event.metadata?.resultId || null,
            attemptNumber: event.metadata?.attemptNumber || null,
            scorePercent: event.scorePercent ?? null,
            correctCount: event.metadata?.correctCount ?? null,
            incorrectCount: event.metadata?.incorrectCount ?? null,
            occurredAt: event.occurredAt,
            quizName: event.contentTitle,
            courseName: event.courseName,
            source: event.source,
            created_date: event.created_date
        }));

        return Response.json({
            studentEmail,
            totalFound: quizEvents.length,
            attempts: diagnostic
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});