import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/**
 * Extract ISO timestamp from webhook payload
 * Handles: seconds (10 digits), milliseconds (13 digits), ISO strings
 */
function extractOccurredAt(payload, receivedAt) {
    // Try each possible timestamp field
    const candidates = [
        payload.occurred_at,
        payload.completed_at,
        payload.created_at,
        payload.timestamp
    ];
    
    for (const candidate of candidates) {
        if (!candidate) continue;
        
        // If it's a string that looks like ISO
        if (typeof candidate === 'string') {
            const isoMatch = candidate.match(/^\d{4}-\d{2}-\d{2}/);
            if (isoMatch) {
                const date = new Date(candidate);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }
        }
        
        // If it's a number (epoch)
        if (typeof candidate === 'number') {
            // 10 digits = seconds
            if (String(candidate).length === 10) {
                const date = new Date(candidate * 1000);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }
            // 13 digits = milliseconds
            if (String(candidate).length === 13) {
                const date = new Date(candidate);
                if (!isNaN(date.getTime())) {
                    return date.toISOString();
                }
            }
        }
    }
    
    // Fallback to receivedAt
    return receivedAt;
}

Deno.serve(async (req) => {
    const requestStartTime = Date.now();
    
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let webhookId = null;
    const receivedAt = new Date().toISOString();
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const topic = body.topic || req.headers.get('x-thinkific-topic');
        webhookId = body.id || crypto.randomUUID();
        
        console.log(`[WEBHOOK] Event: ${topic}, ID: ${webhookId}, received: ${receivedAt}`);

        // Store raw webhook event immediately (append-only)
        await base44.asServiceRole.entities.WebhookEvent.create({
            webhookId: String(webhookId),
            topic: topic,
            receivedAt: receivedAt,
            payloadJson: JSON.stringify(body)
        });

        // Process based on topic (async, don't block response)
        switch (topic) {
            case 'lesson.completed':
                await handleLessonCompleted(base44, body, receivedAt);
                break;
            case 'quiz.attempted':
                await handleQuizAttempted(base44, body, receivedAt);
                break;
            case 'user.signin':
                await handleUserSignin(base44, body, receivedAt);
                break;
            default:
                console.log(`[WEBHOOK] Unhandled topic: ${topic}`);
        }

        const processingTime = Date.now() - requestStartTime;
        return Response.json({ success: true, webhookId, processingTime }, { status: 200 });
    } catch (error) {
        console.error('[WEBHOOK] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function handleLessonCompleted(base44, payload, receivedAt) {
    const {
        id: webhook_id,
        user_id, email, first_name, last_name,
        lesson_id, lesson_name,
        course_id, course_name
    } = payload;

    console.log(`[WEBHOOK] Processing lesson.completed for user ${user_id}, lesson ${lesson_id}`);

    if (!user_id || !lesson_id) {
        console.error('[WEBHOOK] ❌ Missing required fields for lesson.completed');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = extractOccurredAt(payload, receivedAt);
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

async function handleQuizAttempted(base44, payload, receivedAt) {
    console.log(`[QUIZ WEBHOOK] ========== QUIZ.ATTEMPTED ==========`);
    console.log(`[QUIZ WEBHOOK] Full payload:`, JSON.stringify(payload, null, 2));
    
    const {
        id: webhook_id,
        user_id, email, first_name, last_name,
        quiz_id, quiz_name, lesson_id,
        course_id, course_name,
        score, max_score, percentage_score,
        attempt_number, time_spent_seconds,
        quiz_attempt
    } = payload;

    if (!user_id || !quiz_id || score === undefined || !max_score) {
        console.error('[QUIZ WEBHOOK] ❌ Missing required fields');
        return { status: 'error', reason: 'missing_fields' };
    }

    const percentage = percentage_score || Math.round((score / max_score) * 100);
    const occurredAt = extractOccurredAt(payload, receivedAt);
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

async function handleUserSignin(base44, payload, receivedAt) {
    const { id: webhook_id, user_id, email, first_name, last_name } = payload;

    console.log(`[WEBHOOK] Processing user.signin for user ${user_id}, email ${email}`);

    if (!user_id || !email) {
        console.error('[WEBHOOK] ❌ Missing required fields for user.signin');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = extractOccurredAt(payload, receivedAt);
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