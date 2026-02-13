import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        console.log(`[REBUILD] Starting rebuild of quiz attempts from webhooks`);

        // Fetch all quiz.attempted webhook events
        const webhookEvents = await base44.asServiceRole.entities.WebhookEvent.filter({
            topic: 'quiz.attempted'
        });

        console.log(`[REBUILD] Found ${webhookEvents.length} quiz.attempted webhooks`);

        let created = 0;
        let duplicates = 0;
        let errors = [];

        for (const webhook of webhookEvents) {
            try {
                const payload = JSON.parse(webhook.payloadJson);
                const evt = payload; // The root event from Thinkific

                const studentEmail = evt?.payload?.user?.email?.toLowerCase().trim();
                const studentUserId = evt?.payload?.user?.id;
                const quizId = evt?.payload?.quiz?.id;
                const quizName = evt?.payload?.quiz?.name;
                const resultId = evt?.payload?.result_id;
                const courseId = evt?.payload?.course?.id;
                const courseName = evt?.payload?.course?.name;
                
                // Extract score - normalize to 0-100 percentage
                const scorePercent = evt?.payload?.grade != null ? Number(evt.payload.grade) : null;
                const correctCount = evt?.payload?.correct_count != null ? Number(evt.payload.correct_count) : null;
                const incorrectCount = evt?.payload?.incorrect_count != null ? Number(evt.payload.incorrect_count) : null;
                const attemptNumber = evt?.payload?.attempts != null ? Number(evt.payload.attempts) : null;

                // Extract timestamp
                let occurredAt = null;
                if (evt?.created_at) {
                    try {
                        const d = new Date(evt.created_at);
                        if (!Number.isNaN(d.getTime())) {
                            occurredAt = d.toISOString();
                        }
                    } catch (e) {
                        // Fallback
                    }
                }
                if (!occurredAt && typeof evt?.timestamp === 'number') {
                    occurredAt = new Date(evt.timestamp * 1000).toISOString();
                }
                if (!occurredAt) {
                    occurredAt = new Date().toISOString();
                }

                if (!studentEmail || !quizId) {
                    errors.push({
                        webhookId: webhook.webhookId,
                        reason: 'Missing required fields (email or quiz ID)',
                        payload: evt
                    });
                    continue;
                }

                // Create dedupeKey
                const dedupeKey = resultId 
                    ? `quiz_attempted:${resultId}` 
                    : `quiz_attempted:${webhook.webhookId}`;

                // Check if already exists
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({
                    dedupeKey: dedupeKey
                });

                if (existing.length > 0) {
                    duplicates++;
                    continue;
                }

                // Create ActivityEvent
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: String(studentUserId || ''),
                    studentEmail: studentEmail,
                    studentDisplayName: evt?.payload?.user?.first_name 
                        ? `${evt.payload.user.first_name} ${evt.payload.user.last_name || ''}`.trim()
                        : studentEmail.split('@')[0],
                    courseId: String(courseId || ''),
                    courseName: courseName || '',
                    eventType: 'quiz_attempted',
                    contentId: String(quizId),
                    contentTitle: quizName || 'Unknown Quiz',
                    occurredAt: occurredAt,
                    source: 'webhook',
                    rawEventId: String(webhook.webhookId),
                    rawPayload: webhook.payloadJson,
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
                    metadata: {
                        resultId: resultId ? String(resultId) : null,
                        attemptNumber: attemptNumber,
                        correctCount: correctCount,
                        incorrectCount: incorrectCount
                    }
                });

                created++;
                console.log(`[REBUILD] ✓ Created: ${studentEmail} - ${quizName} (${scorePercent}%)`);
            } catch (error) {
                errors.push({
                    webhookId: webhook.webhookId,
                    reason: error.message
                });
                console.error(`[REBUILD] Error processing webhook ${webhook.webhookId}:`, error.message);
            }
        }

        console.log(`[REBUILD] Complete. Created: ${created}, Duplicates: ${duplicates}, Errors: ${errors.length}`);

        return Response.json({
            success: true,
            created,
            duplicates,
            errors,
            total: webhookEvents.length
        });
    } catch (error) {
        console.error('[REBUILD] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});