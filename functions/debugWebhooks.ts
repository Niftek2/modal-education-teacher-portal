import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sessionToken } = await req.json();
        
        await verifySession(sessionToken);

        console.log('[DEBUG] Fetching recent webhook events...');

        // Get last 50 webhook events
        const webhookEvents = await base44.asServiceRole.entities.WebhookEvent.list('-receivedAt', 50);
        
        // Get last 50 webhook logs
        const webhookLogs = await base44.asServiceRole.entities.WebhookEventLog.list('-timestamp', 50);

        // Get quiz completions
        const quizCompletions = await base44.asServiceRole.entities.QuizCompletion.list('-completedAt', 20);
        
        // Get lesson completions
        const lessonCompletions = await base44.asServiceRole.entities.LessonCompletion.list('-completedAt', 20);

        console.log(`[DEBUG] Found:`);
        console.log(`  - ${webhookEvents.length} webhook events`);
        console.log(`  - ${webhookLogs.length} webhook logs`);
        console.log(`  - ${quizCompletions.length} quiz completions`);
        console.log(`  - ${lessonCompletions.length} lesson completions`);

        // Format webhook events for display
        const formattedEvents = webhookEvents.map(event => {
            let payload = {};
            try {
                payload = JSON.parse(event.payloadJson);
            } catch (e) {
                payload = { error: 'Failed to parse' };
            }
            
            return {
                id: event.id,
                topic: event.topic,
                receivedAt: event.receivedAt,
                userId: payload.user_id || 'N/A',
                quizId: payload.quiz_id || 'N/A',
                lessonId: payload.lesson_id || 'N/A',
                email: payload.email || 'N/A'
            };
        });

        // Format logs
        const formattedLogs = webhookLogs.map(log => ({
            id: log.id,
            timestamp: log.timestamp,
            topic: log.topic,
            status: log.status,
            errorMessage: log.errorMessage || null
        }));

        return Response.json({
            summary: {
                totalWebhookEvents: webhookEvents.length,
                totalWebhookLogs: webhookLogs.length,
                totalQuizCompletions: quizCompletions.length,
                totalLessonCompletions: lessonCompletions.length
            },
            recentWebhooks: formattedEvents,
            recentLogs: formattedLogs,
            quizCompletions: quizCompletions.map(q => ({
                id: q.id,
                studentEmail: q.studentEmail,
                quizName: q.quizName,
                score: q.percentage,
                completedAt: q.completedAt
            })),
            lessonCompletions: lessonCompletions.map(l => ({
                id: l.id,
                studentEmail: l.studentEmail,
                lessonName: l.lessonName,
                completedAt: l.completedAt
            }))
        });

    } catch (error) {
        console.error('[DEBUG] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});