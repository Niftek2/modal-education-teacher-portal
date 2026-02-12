import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    const requestStartTime = Date.now();
    
    console.log(`[WEBHOOK] ========== NEW REQUEST ==========`);
    console.log(`[WEBHOOK] Method: ${req.method}`);
    console.log(`[WEBHOOK] URL: ${req.url}`);
    console.log(`[WEBHOOK] Headers:`, Object.fromEntries(req.headers.entries()));
    
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let webhookLogId = null;
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        console.log(`[WEBHOOK] Raw body:`, JSON.stringify(body, null, 2));
        
        const topic = body.topic || req.headers.get('x-thinkific-topic');
        const webhookId = body.id || crypto.randomUUID();
        const userId = body.user_id || body.id;
        
        console.log(`[WEBHOOK] ====================================`);
        console.log(`[WEBHOOK] Received: ${topic}`);
        console.log(`[WEBHOOK] ID: ${webhookId}`);
        console.log(`[WEBHOOK] User ID: ${userId}`);
        console.log(`[WEBHOOK] lesson_id: ${body.lesson_id || 'N/A'}`);
        console.log(`[WEBHOOK] quiz_id: ${body.quiz_id || 'N/A'}`);
        console.log(`[WEBHOOK] Timestamp: ${new Date().toISOString()}`);

        // Store in debug log first
        const logEntry = await base44.asServiceRole.entities.WebhookEventLog.create({
            timestamp: new Date().toISOString(),
            topic: topic || 'unknown',
            rawPayload: JSON.stringify(body),
            status: 'ok'
        });
        webhookLogId = logEntry.id;
        console.log(`[WEBHOOK] Log entry created: ${webhookLogId}`);

        // Store raw webhook event (append-only audit log)
        await base44.asServiceRole.entities.WebhookEvent.create({
            webhookId: String(webhookId),
            topic: topic,
            receivedAt: new Date().toISOString(),
            payloadJson: JSON.stringify(body)
        });

        // Process based on topic
        let processingResult;
        switch (topic) {
            case 'lesson.completed':
                processingResult = await handleLessonCompleted(base44, body);
                break;
            case 'quiz.attempted':
                processingResult = await handleQuizAttempted(base44, body);
                break;
            case 'user.signin':
                processingResult = await handleUserSignin(base44, body);
                break;
            default:
                console.log(`[WEBHOOK] ⚠️ Unhandled topic: ${topic}`);
                processingResult = { status: 'unhandled' };
        }

        const processingTime = Date.now() - requestStartTime;
        console.log(`[WEBHOOK] ✓ Processed in ${processingTime}ms`);
        console.log(`[WEBHOOK] Result:`, processingResult);
        console.log(`[WEBHOOK] ====================================`);

        return Response.json({ success: true, webhookId, processingTime, result: processingResult });
    } catch (error) {
        console.error('[WEBHOOK] Error:', error);
        
        // Update log with error
        if (webhookLogId) {
            try {
                const base44 = createClientFromRequest(req);
                await base44.asServiceRole.entities.WebhookEventLog.update(webhookLogId, {
                    status: 'error',
                    errorMessage: error.message
                });
            } catch (logError) {
                console.error('[WEBHOOK] Failed to log error:', logError);
            }
        }
        
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function handleLessonCompleted(base44, payload) {
    const {
        id: webhook_id,
        user_id, email, first_name, last_name,
        lesson_id, lesson_name,
        course_id, course_name,
        completed_at
    } = payload;

    console.log(`[WEBHOOK] Processing lesson.completed for user ${user_id}, lesson ${lesson_id}`);

    if (!user_id || !lesson_id) {
        console.error('[WEBHOOK] ❌ Missing required fields for lesson.completed');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = completed_at || new Date().toISOString();
    const dedupeKey = await createDedupeKey('lesson', user_id, lesson_id, course_id, occurredAt);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
    if (existing.length > 0) {
        console.log('[WEBHOOK] ⚠️ Lesson completion already exists, skipping (duplicate)');
        return { status: 'duplicate', dedupeKey };
    }

    try {
        // Store in normalized ActivityEvent
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(user_id),
            studentEmail: email || '',
            studentDisplayName: `${first_name || ''} ${last_name || ''}`.trim(),
            courseId: String(course_id || ''),
            courseName: course_name || '',
            eventType: 'lesson_completed',
            contentId: String(lesson_id),
            contentTitle: lesson_name || 'Unknown Lesson',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhook_id || ''),
            rawPayload: JSON.stringify(payload),
            dedupeKey,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ Lesson completion saved: DB ID=${created.id}`);
        return { status: 'created', id: created.id, dedupeKey };
    } catch (error) {
        console.error(`[WEBHOOK] ❌ Failed to save lesson completion:`, error);
        throw error;
    }
}

async function handleQuizAttempted(base44, payload) {
    console.log(`[QUIZ WEBHOOK] ========== QUIZ.ATTEMPTED ==========`);
    console.log(`[QUIZ WEBHOOK] Full payload:`, JSON.stringify(payload, null, 2));
    
    const {
        id: webhook_id,
        user_id, email, first_name, last_name,
        quiz_id, quiz_name, lesson_id,
        course_id, course_name,
        score, max_score, percentage_score,
        attempt_number, completed_at, time_spent_seconds,
        quiz_attempt
    } = payload;

    if (!user_id || !quiz_id || score === undefined || !max_score) {
        console.error('[QUIZ WEBHOOK] ❌ Missing required fields');
        return { status: 'error', reason: 'missing_fields' };
    }

    const percentage = percentage_score || Math.round((score / max_score) * 100);
    const occurredAt = completed_at || new Date().toISOString();
    const dedupeKey = await createDedupeKey('quiz', user_id, quiz_id, course_id, occurredAt);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
    if (existing.length > 0) {
        console.log('[QUIZ WEBHOOK] ⚠️ Quiz attempt already exists, skipping (duplicate)');
        return { status: 'duplicate', dedupeKey };
    }

    try {
        // Store in normalized ActivityEvent
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(user_id),
            studentEmail: email || '',
            studentDisplayName: `${first_name || ''} ${last_name || ''}`.trim(),
            courseId: String(course_id || ''),
            courseName: course_name || '',
            eventType: 'quiz_attempted',
            contentId: String(quiz_id),
            contentTitle: quiz_name || 'Unknown Quiz',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhook_id || ''),
            rawPayload: JSON.stringify(payload),
            dedupeKey,
            metadata: {
                score,
                maxScore: max_score,
                percentage,
                attemptNumber: attempt_number || 1,
                timeSpentSeconds: time_spent_seconds || 0
            }
        });

        console.log(`[QUIZ WEBHOOK] ✓ Quiz attempt saved: DB ID=${created.id}, score=${percentage}%`);
        return { status: 'created', id: created.id, dedupeKey, score: percentage };
    } catch (error) {
        console.error(`[QUIZ WEBHOOK] ❌ Failed to save quiz attempt:`, error);
        throw error;
    }
}

async function handleUserSignin(base44, payload) {
    const { id: webhook_id, user_id, email, first_name, last_name, occurred_at } = payload;

    console.log(`[WEBHOOK] Processing user.signin for user ${user_id}, email ${email}`);

    if (!user_id || !email) {
        console.error('[WEBHOOK] ❌ Missing required fields for user.signin');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = occurred_at || new Date().toISOString();
    const dedupeKey = await createDedupeKey('signin', user_id, null, null, occurredAt);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
    if (existing.length > 0) {
        console.log('[WEBHOOK] ⚠️ Signin already exists, skipping (duplicate)');
        return { status: 'duplicate', dedupeKey };
    }

    try {
        await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(user_id),
            studentEmail: email,
            studentDisplayName: `${first_name || ''} ${last_name || ''}`.trim(),
            courseId: '',
            courseName: '',
            eventType: 'user_signin',
            contentId: '',
            contentTitle: '',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhook_id || ''),
            rawPayload: JSON.stringify(payload),
            dedupeKey,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ User signin tracked`);
        return { status: 'logged', userId: user_id, email };
    } catch (error) {
        console.error(`[WEBHOOK] ❌ Failed to track signin:`, error);
        return { status: 'error', reason: error.message };
    }
}