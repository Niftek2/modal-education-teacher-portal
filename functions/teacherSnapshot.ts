import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);

        // Get all webhook events in last 24h
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        const webhookEvents = await base44.asServiceRole.entities.WebhookEventLog.filter({
            timestamp: { $gte: twentyFourHoursAgo.toISOString() }
        });

        const webhookCountsByTopic = {};
        let lastWebhookTime = null;
        webhookEvents.forEach(event => {
            webhookCountsByTopic[event.topic] = (webhookCountsByTopic[event.topic] || 0) + 1;
            if (!lastWebhookTime || new Date(event.timestamp) > new Date(lastWebhookTime)) {
                lastWebhookTime = event.timestamp;
            }
        });

        // Get all activity events in last 24h
        const activityEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            occurredAt: { $gte: twentyFourHoursAgo.toISOString() }
        });

        const activityCountsByType = {};
        activityEvents.forEach(event => {
            activityCountsByType[event.eventType] = (activityCountsByType[event.eventType] || 0) + 1;
        });

        // Get all activity events for per-student sample
        const allActivityEvents = await base44.asServiceRole.entities.ActivityEvent.list();

        // Build per-student sample
        const studentMap = {};
        allActivityEvents.forEach(event => {
            if (!studentMap[event.studentEmail]) {
                studentMap[event.studentEmail] = {
                    email: event.studentEmail,
                    displayName: event.studentDisplayName,
                    quizCount: 0,
                    lessonCount: 0,
                    unknownLevelQuizCount: 0
                };
            }
            
            if (event.eventType === 'quiz_attempted') {
                studentMap[event.studentEmail].quizCount++;
                // Count quizzes without a level in metadata
                if (!event.metadata?.level) {
                    studentMap[event.studentEmail].unknownLevelQuizCount++;
                }
            } else if (event.eventType === 'lesson_completed') {
                studentMap[event.studentEmail].lessonCount++;
            }
        });

        const perStudentSample = Object.values(studentMap).sort((a, b) => b.quizCount - a.quizCount);

        return Response.json({
            timestamp: new Date().toISOString(),
            user: {
                email: session.email
            },
            summary: {
                totalWebhookEventsLast24h: webhookEvents.length,
                totalActivityEventsLast24h: activityEvents.length,
                lastWebhookReceived: lastWebhookTime,
                uniqueStudents: Object.keys(studentMap).length
            },
            webhooks: {
                countsByTopic: webhookCountsByTopic,
                lastReceived: lastWebhookTime
            },
            activity: {
                countsByType: activityCountsByType
            },
            perStudentSample: perStudentSample.slice(0, 50)
        });

    } catch (error) {
        console.error('Snapshot error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});