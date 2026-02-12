import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Get all webhook events
        const webhookEvents = await base44.asServiceRole.entities.WebhookEventLog.list('-timestamp', 1000);
        
        // Get all activity events
        const activityEvents = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', 1000);

        // Calculate last 24h
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const webhooksLast24h = webhookEvents.filter(w => new Date(w.timestamp) > oneDayAgo);
        const activitiesLast24h = activityEvents.filter(a => new Date(a.occurredAt) > oneDayAgo);

        // Group activities by event type
        const activityCountsByType = {};
        activitiesLast24h.forEach(a => {
            activityCountsByType[a.eventType] = (activityCountsByType[a.eventType] || 0) + 1;
        });

        // Per-student sample
        const studentEmails = new Set(activityEvents.map(a => a.studentEmail).filter(Boolean));
        const perStudentSample = {};

        for (const email of studentEmails) {
            const studentActivities = activityEvents.filter(a => a.studentEmail === email);
            const studentQuizzes = studentActivities.filter(a => a.eventType === 'quiz_attempted');
            
            // Count quizzes with unknown level (no courseId or courseId not in standard levels)
            const standardLevels = ['K', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'PK'];
            const unknownLevelQuizzes = studentQuizzes.filter(q => 
                !q.courseId || !standardLevels.includes(q.courseId)
            );

            perStudentSample[email] = {
                totalActivities: studentActivities.length,
                totalQuizzes: studentQuizzes.length,
                unknownLevelQuizCount: unknownLevelQuizzes.length,
                lastActivity: studentActivities.length > 0 ? studentActivities[0].occurredAt : null,
                courses: [...new Set(studentActivities.map(a => a.courseId).filter(Boolean))]
            };
        }

        return Response.json({
            timestamp: new Date().toISOString(),
            entitlement: {
                userEmail: user.email,
                userRole: user.role
            },
            groups: {
                count: 0,
                list: []
            },
            roster: {
                totalStudents: studentEmails.size,
                emails: Array.from(studentEmails).sort()
            },
            webhooks: {
                lastReceived: webhookEvents.length > 0 ? webhookEvents[0].timestamp : null,
                countLast24h: webhooksLast24h.length,
                topicsLast24h: webhooksLast24h.reduce((acc, w) => {
                    acc[w.topic] = (acc[w.topic] || 0) + 1;
                    return acc;
                }, {})
            },
            activityEvents: {
                totalCount: activityEvents.length,
                countLast24h: activitiesLast24h.length,
                countsByTypeLast24h: activityCountsByType
            },
            perStudentSample: perStudentSample,
            summary: {
                totalWebhookEvents: webhookEvents.length,
                totalActivityEvents: activityEvents.length,
                uniqueStudents: studentEmails.size
            }
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});