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

        // Fetch all quiz attempts for this student
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const quizEvents = allEvents.filter(e => 
            (e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted') &&
            e.studentEmail?.toLowerCase() === studentEmail.toLowerCase()
        );

        // Sort by date descending, take last 20
        const sorted = quizEvents.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, 20);

        const results = sorted.map(e => {
            let metadata = e.metadata || {};
            if (typeof metadata === 'string') {
                try {
                    metadata = JSON.parse(metadata);
                } catch {
                    metadata = {};
                }
            }

            let payloadGrade = null;
            if (e.rawPayload) {
                try {
                    const payload = typeof e.rawPayload === 'string' ? JSON.parse(e.rawPayload) : e.rawPayload;
                    payloadGrade = payload?.grade;
                } catch {
                    // ignore
                }
            }

            return {
                occurredAt: e.occurredAt,
                quizName: e.contentTitle,
                eventType: e.eventType,
                resultId: metadata.resultId || null,
                attemptNumber: metadata.attemptNumber || null,
                scorePercent: metadata.scorePercent,
                correctCount: metadata.correctCount,
                incorrectCount: metadata.incorrectCount,
                rawPayloadGrade: payloadGrade,
                dedupeKey: e.dedupeKey
            };
        });

        return Response.json({
            studentEmail,
            totalQuizAttempts: quizEvents.length,
            last20: results
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});