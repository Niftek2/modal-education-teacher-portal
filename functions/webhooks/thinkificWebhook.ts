import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Thinkific Webhook Receiver
 * 
 * Responds fast (< 1s), stores raw payloads, normalizes to ActivityEvent.
 * Topics: lesson.completed, quiz.attempted, user.signin, enrollment.created, user.signup, subscription.canceled
 * 
 * Idempotency: Dedupes by webhook ID to prevent duplicate ActivityEvent records on retries.
 */

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

function normalizeEventType(resource, action) {
    const incomingType = `${resource}.${action}`;
    
    // Canonical mapping - strict, returns null if unknown
    const typeMap = {
        'quiz.attempted': 'quiz_attempted',
        'lesson.completed': 'lesson_completed',
        'enrollment.created': 'enrollment_created',
        'user.signin': 'user_signin',
        'user.signup': 'user_signup',
        'user.sign_up': 'user_signup' // Alias handling
    };
    
    return typeMap[incomingType] || null;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let webhookId = null;
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        webhookId = body.id;
        const resource = body.resource;
        const action = body.action;
        const canonicalTopic = resource && action ? `${resource}.${action}` : (body.topic || req.headers.get('x-thinkific-topic'));
        const eventType = resource && action ? normalizeEventType(resource, action) : null;
        
        console.log(`[WEBHOOK] Received ${canonicalTopic}, ID: ${webhookId}, eventType: ${eventType}`);

        // Idempotent WebhookEvent storage
        const existingWebhook = await base44.asServiceRole.entities.WebhookEvent.filter({ webhookId: String(webhookId) });
        if (existingWebhook.length === 0) {
            await base44.asServiceRole.entities.WebhookEvent.create({
                webhookId: String(webhookId),
                topic: canonicalTopic,
                receivedAt: new Date().toISOString(),
                payloadJson: JSON.stringify(body)
            });
        }

        // Handle subscription.canceled first (no eventType needed)
        if (canonicalTopic === 'subscription.canceled') {
            await handleSubscriptionCanceled(base44, body);
            return Response.json({ success: true, webhookId }, { status: 200 });
        }

        // If eventType is null (unknown), log and return 200 without creating ActivityEvent
        if (!eventType) {
            console.log(`[WEBHOOK] Unknown event type for ${canonicalTopic}, stored raw but skipping ActivityEvent`);
            return Response.json({ success: true, webhookId, skipped: true }, { status: 200 });
        }

        // Route to handler based on canonicalTopic, pass eventType
        if (canonicalTopic === 'lesson.completed') {
            await handleLessonCompleted(base44, body, eventType);
        } else if (canonicalTopic === 'quiz.attempted') {
            await handleQuizAttempted(base44, body, eventType);
        } else if (canonicalTopic === 'user.signin') {
            await handleUserSignin(base44, body, eventType);
        } else if (canonicalTopic === 'enrollment.created') {
            await handleEnrollmentCreated(base44, body, eventType);
        } else if (canonicalTopic === 'user.signup' || canonicalTopic === 'user.sign_up') {
            await handleUserSignup(base44, body, eventType);
        }

        return Response.json({ success: true, webhookId }, { status: 200 });
    } catch (error) {
        console.error('[WEBHOOK] Error:', error.message);
        return Response.json({ success: true }, { status: 200 });
    }
});

async function handleLessonCompleted(base44, body, eventType) {
    const webhookId = body.id;
    const payload = body.payload;
    const user = payload?.user;
    const lesson = payload?.lesson;
    const course = payload?.course;
    
    const userId = user?.id;
    const email = user?.email;
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    const lessonId = lesson?.id;
    const lessonName = lesson?.name;
    const courseId = course?.id;
    const courseName = course?.name;
    const occurredAt = body.created_at || new Date().toISOString();

    console.log(`[WEBHOOK] lesson.completed: user=${userId}, lesson=${lessonId}`);

    if (!webhookId || !userId || !lessonId) {
        console.error('[WEBHOOK] Missing required fields for lesson.completed');
        return;
    }

    // Idempotency: Check by webhook ID
    const existingByWebhook = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: String(webhookId) });
    if (existingByWebhook.length > 0) {
        console.log('[WEBHOOK] Lesson completion already stored (duplicate by webhook ID)');
        return;
    }

    const dedupeKey = await createDedupeKey('lesson', userId, lessonId, courseId, occurredAt);

    try {
        // Update LessonCourseMap
        if (lessonId && courseId && courseName) {
            const existingMap = await base44.asServiceRole.entities.LessonCourseMap.filter({ lessonId: String(lessonId) });
            if (existingMap.length > 0) {
                await base44.asServiceRole.entities.LessonCourseMap.update(existingMap[0].id, {
                    courseId: String(courseId),
                    courseName: courseName,
                    lastSeenAt: new Date().toISOString()
                });
            } else {
                await base44.asServiceRole.entities.LessonCourseMap.create({
                    lessonId: String(lessonId),
                    courseId: String(courseId),
                    courseName: courseName,
                    lastSeenAt: new Date().toISOString()
                });
            }
        }

        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(userId),
            thinkificUserId: userId,
            studentEmail: (email || '').toLowerCase().trim(),
            studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
            courseId: String(courseId || ''),
            courseName: courseName || '',
            eventType: eventType,
            contentId: String(lessonId),
            contentTitle: lessonName || 'Unknown Lesson',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(body),
            dedupeKey,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ Lesson saved: DB ID=${created.id}`);
        
        await base44.functions.invoke('markAssignmentComplete', { activityEventId: created.id });
    } catch (error) {
        console.error(`[WEBHOOK] Failed to save lesson completion:`, error.message);
    }
}

async function handleQuizAttempted(base44, body, eventType) {
    const webhookId = body.id;
    const payload = body.payload;
    const user = payload?.user;
    const quiz = payload?.quiz;
    const lesson = payload?.lesson;
    
    const userId = user?.id;
    const email = user?.email;
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    const quizId = quiz?.id;
    const quizName = quiz?.name;
    const lessonId = lesson?.id;
    const grade = payload?.grade;
    const correctCount = payload?.correct_count;
    const incorrectCount = payload?.incorrect_count;
    const attemptNumber = payload?.attempts;
    const occurredAt = body.created_at || new Date().toISOString();

    console.log(`[WEBHOOK] quiz.attempted: user=${userId}, quiz=${quizId}, grade=${grade}`);

    if (!webhookId || !userId || !quizId) {
        console.error('[WEBHOOK] Missing required fields for quiz.attempted');
        return;
    }

    // Idempotency: Check by webhook ID
    const existingByWebhook = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: String(webhookId) });
    if (existingByWebhook.length > 0) {
        console.log('[WEBHOOK] Quiz attempt already stored (duplicate by webhook ID)');
        return;
    }

    const dedupeKey = await createDedupeKey('quiz', userId, quizId, null, occurredAt);

    // Score calculation: prioritize grade, do not coerce non-numeric correct_count
    let scorePercent = null;
    if (typeof grade === 'number') {
        scorePercent = grade;
    }
    
    // Clean correctCount/incorrectCount - only store if numeric
    const cleanCorrectCount = typeof correctCount === 'number' ? correctCount : null;
    const cleanIncorrectCount = typeof incorrectCount === 'number' ? incorrectCount : null;

    try {
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(userId),
            thinkificUserId: userId,
            studentEmail: (email || '').toLowerCase().trim(),
            studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
            courseId: '',
            courseName: '',
            eventType: eventType,
            contentId: String(quizId),
            contentTitle: quizName || '',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(body),
            dedupeKey,
            scorePercent: scorePercent,
            metadata: {
                lessonId: lessonId,
                correctCount: cleanCorrectCount,
                incorrectCount: cleanIncorrectCount,
                attemptNumber: attemptNumber || 1
            }
        });

        console.log(`[WEBHOOK] ✓ Quiz saved: DB ID=${created.id}, score=${scorePercent}%`);
        
        await base44.functions.invoke('markAssignmentComplete', { activityEventId: created.id });
    } catch (error) {
        console.error(`[WEBHOOK] Failed to save quiz attempt:`, error.message);
    }
}

async function handleUserSignin(base44, body, eventType) {
    const webhookId = body.id;
    const payload = body.payload;
    const userId = payload?.id;
    const email = payload?.email;
    const firstName = payload?.first_name;
    const lastName = payload?.last_name;
    const occurredAt = body.created_at || new Date().toISOString();

    console.log(`[WEBHOOK] user.signin: user=${userId}, email=${email}`);

    if (!webhookId || !userId || !email) {
        console.error('[WEBHOOK] Missing required fields for user.signin');
        return;
    }

    // Idempotency: Check by webhook ID
    const existingByWebhook = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: String(webhookId) });
    if (existingByWebhook.length > 0) {
        console.log('[WEBHOOK] Signin already stored (duplicate by webhook ID)');
        return;
    }

    const dedupeKey = await createDedupeKey('signin', userId, null, null, occurredAt);

    try {
        await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(userId),
            thinkificUserId: userId,
            studentEmail: (email || '').toLowerCase().trim(),
            studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
            courseId: '',
            courseName: '',
            eventType: eventType,
            contentId: '',
            contentTitle: '',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(body),
            dedupeKey,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ Signin logged`);
    } catch (error) {
        console.error(`[WEBHOOK] Failed to log signin:`, error.message);
    }
}

async function handleEnrollmentCreated(base44, body, eventType) {
    const webhookId = body.id;
    const payload = body.payload;
    const user = payload?.user;
    const course = payload?.course;
    
    const userId = user?.id;
    const email = user?.email;
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    const enrollmentId = payload?.id;
    const courseId = course?.id;
    const courseName = course?.name;
    const occurredAt = body.created_at || payload?.created_at || new Date().toISOString();

    console.log(`[WEBHOOK] enrollment.created: user=${userId}, course=${courseId}`);

    if (!webhookId || !userId || !courseId) {
        console.error('[WEBHOOK] Missing required fields for enrollment.created');
        return;
    }

    // Idempotency: Check by webhook ID
    const existingByWebhook = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: String(webhookId) });
    if (existingByWebhook.length > 0) {
        console.log('[WEBHOOK] Enrollment already stored (duplicate by webhook ID)');
        return;
    }

    const dedupeKey = await createDedupeKey('enrollment', userId, enrollmentId, courseId, occurredAt);

    try {
        await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(userId),
            thinkificUserId: userId,
            studentEmail: (email || '').toLowerCase().trim(),
            studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
            courseId: String(courseId),
            courseName: courseName || '',
            eventType: eventType,
            contentId: String(enrollmentId || ''),
            contentTitle: '',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(body),
            dedupeKey,
            metadata: {
                enrollmentId: enrollmentId
            }
        });

        console.log(`[WEBHOOK] ✓ Enrollment logged`);
    } catch (error) {
        console.error(`[WEBHOOK] Failed to log enrollment:`, error.message);
    }
}

async function handleUserSignup(base44, body, eventType) {
    const webhookId = body.id;
    const payload = body.payload;
    const userId = payload?.id;
    const email = payload?.email;
    const firstName = payload?.first_name;
    const lastName = payload?.last_name;
    const occurredAt = body.created_at || payload?.created_at || new Date().toISOString();

    console.log(`[WEBHOOK] user.signup: user=${userId}, email=${email}`);

    if (!webhookId || !userId || !email) {
        console.error('[WEBHOOK] Missing required fields for user.signup');
        return;
    }

    // Idempotency: Check by webhook ID
    const existingByWebhook = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: String(webhookId) });
    if (existingByWebhook.length > 0) {
        console.log('[WEBHOOK] Signup already stored (duplicate by webhook ID)');
        return;
    }

    const dedupeKey = await createDedupeKey('signup', userId, null, null, occurredAt);

    try {
        await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(userId),
            thinkificUserId: userId,
            studentEmail: (email || '').toLowerCase().trim(),
            studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
            courseId: '',
            courseName: '',
            eventType: eventType,
            contentId: '',
            contentTitle: '',
            occurredAt,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(body),
            dedupeKey,
            metadata: {}
        });

        console.log(`[WEBHOOK] ✓ Signup logged`);
    } catch (error) {
        console.error(`[WEBHOOK] Failed to log signup:`, error.message);
    }
}

async function handleSubscriptionCanceled(base44, body) {
    const webhookId = body.id;
    const payload = body.payload;
    const user = payload?.user;
    
    const userId = user?.id;
    const email = user?.email;
    const subscriptionId = payload?.id;
    const occurredAt = body.created_at || new Date().toISOString();

    console.log(`[WEBHOOK] subscription.canceled: user=${userId}, subscription=${subscriptionId}`);

    if (!userId || !email) {
        console.error('[WEBHOOK] Missing required fields for subscription.canceled');
        return;
    }

    try {
        // Update TeacherAccess
        const existingAccess = await base44.asServiceRole.entities.TeacherAccess.filter({ 
            teacherEmail: email.toLowerCase().trim() 
        });

        if (existingAccess.length > 0) {
            await base44.asServiceRole.entities.TeacherAccess.update(existingAccess[0].id, {
                status: 'ended',
                lastWebhookId: String(webhookId)
            });
            console.log(`[WEBHOOK] ✓ TeacherAccess updated to 'ended'`);
        } else {
            console.log(`[WEBHOOK] No TeacherAccess record found for ${email}`);
        }
    } catch (error) {
        console.error(`[WEBHOOK] Failed to handle subscription cancellation:`, error.message);
    }
}