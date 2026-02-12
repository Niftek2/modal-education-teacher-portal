import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Extract ISO timestamp from top-level webhook fields
 * Thinkific sends: created_at (ISO string) or timestamp (epoch seconds)
 */
function extractOccurredAt(evt) {
    if (evt?.created_at) {
        const d = new Date(evt.created_at);
        if (!Number.isNaN(d.getTime())) {
            return d;
        }
    }
    if (typeof evt?.timestamp === 'number') {
        const d = new Date(evt.timestamp * 1000); // seconds -> ms
        if (!Number.isNaN(d.getTime())) {
            return d;
        }
    }
    // Fallback with warning
    console.warn(`[WEBHOOK] Could not parse timestamp from event ${evt?.id}: created_at=${evt?.created_at}, timestamp=${evt?.timestamp}`);
    return new Date();
}

/**
 * Extract student email from webhook payload
 */
function extractStudentEmail(evt) {
    return evt?.payload?.user?.email || evt?.payload?.email || null;
}

/**
 * Extract student Thinkific user ID
 */
function extractStudentThinkificUserId(evt) {
    return evt?.payload?.user?.id || evt?.payload?.id || null;
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
        const evt = await req.json();
        
        // Thinkific sends: resource, action, created_at, timestamp, payload, id
        const resource = evt.resource || 'unknown';
        const action = evt.action || 'unknown';
        const eventType = `${resource}.${action}`;
        webhookId = evt.id || crypto.randomUUID();
        
        console.log(`[WEBHOOK] Event: ${eventType}, ID: ${webhookId}, received: ${receivedAt}`);

        // Store raw webhook event immediately (append-only)
        await base44.asServiceRole.entities.WebhookEvent.create({
            webhookId: String(webhookId),
            topic: eventType,
            receivedAt: receivedAt,
            payloadJson: JSON.stringify(evt)
        });

        // Process based on resource.action (async, don't block response)
        switch (eventType) {
            case 'lesson.completed':
                await handleLessonCompleted(base44, evt, webhookId);
                break;
            case 'quiz.attempted':
                await handleQuizAttempted(base44, evt, webhookId);
                break;
            case 'user.signin':
                await handleUserSignin(base44, evt, webhookId);
                break;
            default:
                console.log(`[WEBHOOK] Unhandled event type: ${eventType}`);
        }

        const processingTime = Date.now() - requestStartTime;
        return Response.json({ success: true, webhookId, processingTime }, { status: 200 });
    } catch (error) {
        console.error('[WEBHOOK] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function handleLessonCompleted(base44, evt, webhookId) {
    const { payload } = evt;
    const studentEmail = extractStudentEmail(evt);
    const studentUserId = extractStudentThinkificUserId(evt);
    
    const courseId = payload?.course?.id;
    const courseName = payload?.course?.name;
    const lessonId = payload?.lesson?.id;
    const lessonName = payload?.lesson?.name;
    const enrollmentId = payload?.enrollment?.id;

    console.log(`[WEBHOOK] Processing lesson.completed: student=${studentEmail}, lesson=${lessonId}`);

    if (!studentEmail || !lessonId) {
        console.error('[WEBHOOK] ❌ Missing required fields for lesson.completed');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = extractOccurredAt(evt);
    const occurredAtIso = occurredAt.toISOString();
    const dedupeKey = enrollmentId && lessonId ? `${enrollmentId}-${lessonId}` : webhookId;

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: webhookId });
    if (existing.length > 0) {
        console.log('[WEBHOOK] ⚠️ Lesson completion already exists, skipping (duplicate)');
        return { status: 'duplicate' };
    }

    try {
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(studentUserId || ''),
            studentEmail: studentEmail,
            studentDisplayName: studentEmail.split('@')[0],
            courseId: String(courseId || ''),
            courseName: courseName || '',
            eventType: 'lesson.completed',
            contentId: String(lessonId),
            contentTitle: lessonName || 'Unknown Lesson',
            occurredAt: occurredAtIso,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(payload),
            dedupeKey: dedupeKey,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ Lesson completion saved: student=${studentEmail}, occurredAt=${occurredAtIso}`);
        return { status: 'created', id: created.id };
    } catch (error) {
        console.error(`[WEBHOOK] ❌ Failed to save lesson completion:`, error);
        throw error;
    }
}

async function handleQuizAttempted(base44, evt, webhookId) {
    const { payload } = evt;
    const studentEmail = extractStudentEmail(evt);
    const studentUserId = extractStudentThinkificUserId(evt);
    
    const quizId = payload?.quiz?.id;
    const quizName = payload?.quiz?.name;
    const lessonId = payload?.lesson?.id;
    const resultId = payload?.result_id;
    const grade = payload?.grade;
    const correctCount = payload?.correct_count;
    const incorrectCount = payload?.incorrect_count;

    console.log(`[QUIZ WEBHOOK] Processing quiz.attempted: student=${studentEmail}, quiz=${quizId}, resultId=${resultId}`);

    if (!studentEmail || !quizId) {
        console.error('[QUIZ WEBHOOK] ❌ Missing required fields');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = extractOccurredAt(evt);
    const occurredAtIso = occurredAt.toISOString();
    const dedupeKey = resultId || webhookId;

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: webhookId });
    if (existing.length > 0) {
        console.log('[QUIZ WEBHOOK] ⚠️ Quiz attempt already exists, skipping (duplicate)');
        return { status: 'duplicate' };
    }

    try {
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(studentUserId || ''),
            studentEmail: studentEmail,
            studentDisplayName: studentEmail.split('@')[0],
            courseId: '', // Not available in quiz webhook payload
            courseName: '',
            eventType: 'quiz.attempted',
            contentId: String(quizId),
            contentTitle: quizName || 'Unknown Quiz',
            occurredAt: occurredAtIso,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(payload),
            dedupeKey: dedupeKey,
            metadata: {
                grade: grade || null,
                correctCount: correctCount || 0,
                incorrectCount: incorrectCount || 0,
                resultId: resultId || null
            }
        });

        console.log(`[QUIZ WEBHOOK] ✓ Quiz attempt saved: student=${studentEmail}, grade=${grade}, occurredAt=${occurredAtIso}`);
        return { status: 'created', id: created.id };
    } catch (error) {
        console.error(`[QUIZ WEBHOOK] ❌ Failed to save quiz attempt:`, error);
        throw error;
    }
}

async function handleUserSignin(base44, evt, webhookId) {
    const { payload } = evt;
    const studentEmail = extractStudentEmail(evt);
    const studentUserId = extractStudentThinkificUserId(evt);

    console.log(`[WEBHOOK] Processing user.signin: user=${studentUserId}, email=${studentEmail}`);

    if (!studentEmail) {
        console.error('[WEBHOOK] ❌ Missing required fields for user.signin');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = extractOccurredAt(evt);
    const occurredAtIso = occurredAt.toISOString();

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: webhookId });
    if (existing.length > 0) {
        console.log('[WEBHOOK] ⚠️ Signin already exists, skipping (duplicate)');
        return { status: 'duplicate' };
    }

    try {
        await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(studentUserId || ''),
            studentEmail: studentEmail,
            studentDisplayName: studentEmail.split('@')[0],
            courseId: '',
            courseName: '',
            eventType: 'user.signin',
            contentId: '',
            contentTitle: '',
            occurredAt: occurredAtIso,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(payload),
            dedupeKey: webhookId,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ User signin tracked: email=${studentEmail}, occurredAt=${occurredAtIso}`);
        return { status: 'logged', userId: studentUserId, email: studentEmail };
    } catch (error) {
        console.error(`[WEBHOOK] ❌ Failed to track signin:`, error);
        return { status: 'error', reason: error.message };
    }
}