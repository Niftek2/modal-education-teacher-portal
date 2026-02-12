import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Thinkific Webhook Receiver
 * 
 * Responds fast (< 1s), stores raw payloads, normalizes to ActivityEvent.
 * Topics: lesson.completed, quiz.attempted, user.signin
 */

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    const requestStartTime = Date.now();
    
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let webhookId = null;
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const topic = body.topic || req.headers.get('x-thinkific-topic');
        webhookId = body.id || crypto.randomUUID();
        
        console.log(`[WEBHOOK] Event: ${topic}, ID: ${webhookId}`);

        // Store raw webhook event immediately (append-only for debugging)
        await base44.asServiceRole.entities.WebhookEvent.create({
            webhookId: String(webhookId),
            topic: topic,
            receivedAt: new Date().toISOString(),
            payloadJson: JSON.stringify(body)
        });

        // Process based on topic (async, don't block response)
        let processed = false;
        
        if (topic === 'lesson.completed') {
            await handleLessonCompleted(base44, body);
            processed = true;
        } else if (topic === 'quiz.attempted') {
            await handleQuizAttempted(base44, body);
            processed = true;
        } else if (topic === 'user.signin') {
            await handleUserSignin(base44, body);
            processed = true;
        } else {
            console.log(`[WEBHOOK] Unhandled topic: ${topic}`);
        }

        const processingTime = Date.now() - requestStartTime;
        return Response.json({ success: true, webhookId, processed, processingTime }, { status: 200 });
    } catch (error) {
        console.error('[WEBHOOK] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function handleLessonCompleted(base44, payload) {
    const {
        id: webhook_id,
        user_id,
        email,
        first_name,
        last_name,
        lesson_id,
        lesson_name,
        course_id,
        course_name,
        completed_at
    } = payload;

    console.log(`[WEBHOOK] lesson.completed: user=${user_id}, lesson=${lesson_id}`);

    if (!user_id || !lesson_id) {
        console.error('[WEBHOOK] Missing required fields for lesson.completed');
        return;
    }

    const occurredAt = completed_at || new Date().toISOString();
    const dedupeKey = await createDedupeKey('lesson', user_id, lesson_id, course_id, occurredAt);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
    if (existing.length > 0) {
        console.log('[WEBHOOK] Lesson completion already stored (duplicate)');
        return;
    }

    try {
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

        console.log(`[WEBHOOK] ✓ Lesson saved: DB ID=${created.id}`);
    } catch (error) {
        console.error(`[WEBHOOK] Failed to save lesson completion:`, error.message);
    }
}

async function handleQuizAttempted(base44, payload) {
    const {
        id: webhook_id,
        user_id,
        email,
        first_name,
        last_name,
        quiz_id,
        quiz_name,
        course_id,
        course_name,
        score,
        max_score,
        percentage_score,
        attempt_number,
        completed_at,
        time_spent_seconds
    } = payload;

    console.log(`[WEBHOOK] quiz.attempted: user=${user_id}, quiz=${quiz_id}, score=${score}/${max_score}`);

    if (!user_id || !quiz_id || score === undefined || max_score === undefined) {
        console.error('[WEBHOOK] Missing required fields for quiz.attempted');
        return;
    }

    const percentage = percentage_score || Math.round((score / max_score) * 100);
    const occurredAt = completed_at || new Date().toISOString();
    const dedupeKey = await createDedupeKey('quiz', user_id, quiz_id, course_id, occurredAt);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
    if (existing.length > 0) {
        console.log('[WEBHOOK] Quiz attempt already stored (duplicate)');
        return;
    }

    try {
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

        console.log(`[WEBHOOK] ✓ Quiz saved: DB ID=${created.id}`);
    } catch (error) {
        console.error(`[WEBHOOK] Failed to save quiz attempt:`, error.message);
    }
}

async function handleUserSignin(base44, payload) {
    const { id: webhook_id, user_id, email, first_name, last_name, occurred_at } = payload;

    console.log(`[WEBHOOK] user.signin: user=${user_id}, email=${email}`);

    if (!user_id || !email) {
        console.error('[WEBHOOK] Missing required fields for user.signin');
        return;
    }

    const occurredAt = occurred_at || new Date().toISOString();
    const dedupeKey = await createDedupeKey('signin', user_id, null, null, occurredAt);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
    if (existing.length > 0) {
        console.log('[WEBHOOK] Signin already stored (duplicate)');
        return;
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

        console.log(`[WEBHOOK] ✓ Signin logged`);
    } catch (error) {
        console.error(`[WEBHOOK] Failed to log signin:`, error.message);
    }
}