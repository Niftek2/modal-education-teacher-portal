import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * PRODUCTION LOCKED: Primary webhook ingestion endpoint
 * Normalizes all Thinkific webhooks into ActivityEvent table
 * Idempotent by webhook event ID
 */

async function upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt) {
    if (!userId) return;
    
    const displayName = `${firstName || ''} ${lastName || ''}`.trim();
    const normalizedEmail = (email || '').toLowerCase().trim();
    
    const existing = await base44.asServiceRole.entities.StudentProfile.filter({ thinkificUserId: userId });
    
    if (existing.length > 0) {
        await base44.asServiceRole.entities.StudentProfile.update(existing[0].id, {
            displayName: displayName || existing[0].displayName,
            email: normalizedEmail || existing[0].email,
            firstName: firstName || existing[0].firstName,
            lastName: lastName || existing[0].lastName,
            lastSeenAt: occurredAt
        });
    } else {
        await base44.asServiceRole.entities.StudentProfile.create({
            thinkificUserId: userId,
            displayName: displayName || normalizedEmail,
            email: normalizedEmail,
            firstName: firstName || '',
            lastName: lastName || '',
            lastSeenAt: occurredAt
        });
    }
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
        const eventType = `${resource}.${action}`;
        const occurredAt = body.created_at || body.timestamp || new Date().toISOString();
        const payload = body.payload || {};
        
        console.log(`[WEBHOOK] Received ${eventType}, ID: ${webhookId}`);

        if (!webhookId || !resource || !action) {
            console.error('[WEBHOOK] Missing required wrapper fields');
            return Response.json({ success: true }, { status: 200 });
        }

        // Idempotency check: dedupeKey = "wh:{webhookId}"
        const dedupeKey = `wh:${webhookId}`;
        const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
        
        if (existing.length > 0) {
            console.log(`[WEBHOOK] Duplicate webhook ${webhookId}, skipping`);
            return Response.json({ success: true, skipped: true }, { status: 200 });
        }

        // Store raw webhook for audit
        const existingWebhook = await base44.asServiceRole.entities.WebhookEvent.filter({ webhookId: String(webhookId) });
        if (existingWebhook.length === 0) {
            await base44.asServiceRole.entities.WebhookEvent.create({
                webhookId: String(webhookId),
                topic: eventType,
                receivedAt: new Date().toISOString(),
                payloadJson: JSON.stringify(body)
            });
        }

        // Handle subscription.canceled (no activity event needed)
        if (eventType === 'subscription.canceled') {
            await handleSubscriptionCanceled(base44, payload, webhookId);
            return Response.json({ success: true }, { status: 200 });
        }

        // Route to specific handler
        if (eventType === 'lesson.completed') {
            await handleLessonCompleted(base44, payload, webhookId, dedupeKey, occurredAt, body);
        } else if (eventType === 'quiz.attempted') {
            await handleQuizAttempted(base44, payload, webhookId, dedupeKey, occurredAt, body);
        } else if (eventType === 'user.signin') {
            await handleUserSignin(base44, payload, webhookId, dedupeKey, occurredAt, body);
        } else if (eventType === 'enrollment.created') {
            await handleEnrollmentCreated(base44, payload, webhookId, dedupeKey, occurredAt, body);
        } else if (eventType === 'user.signup' || eventType === 'user.sign_up') {
            await handleUserSignup(base44, payload, webhookId, dedupeKey, occurredAt, body);
        } else {
            console.log(`[WEBHOOK] Unknown event type: ${eventType}, stored raw but skipped activity`);
        }

        return Response.json({ success: true }, { status: 200 });
    } catch (error) {
        console.error('[WEBHOOK] Error:', error.message);
        return Response.json({ success: true }, { status: 200 });
    }
});

async function handleLessonCompleted(base44, payload, webhookId, dedupeKey, occurredAt, rawBody) {
    const user = payload?.user;
    const lesson = payload?.lesson;
    const course = payload?.course;
    const chapter = payload?.chapter;
    
    const userId = user?.id;
    const email = user?.email;
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    
    if (!userId || !lesson?.id) {
        console.error('[WEBHOOK] Missing required fields for lesson.completed');
        return;
    }

    await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

    const activity = {
        thinkificUserId: userId,
        source: 'webhook',
        eventType: 'lesson_completed',
        occurredAt,
        dedupeKey,
        webhookEventId: String(webhookId),
        courseId: course?.id || null,
        courseName: course?.name || null,
        chapterId: chapter?.id || null,
        chapterName: chapter?.name || null,
        lessonId: lesson?.id || null,
        lessonName: lesson?.name || null,
        lessonType: lesson?.lesson_type || null,
        lessonPosition: lesson?.position || null,
        studentEmail: (email || '').toLowerCase().trim(),
        studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
        rawPayload: JSON.stringify(rawBody)
    };

    const created = await base44.asServiceRole.entities.ActivityEvent.create(activity);
    console.log(`[WEBHOOK] ✓ Lesson completed saved: ${created.id}`);
    
    // Trigger assignment completion check
    await base44.functions.invoke('markAssignmentComplete', { activityEventId: created.id });
}

async function handleQuizAttempted(base44, payload, webhookId, dedupeKey, occurredAt, rawBody) {
    const user = payload?.user;
    const quiz = payload?.quiz;
    const lesson = payload?.lesson;
    const course = payload?.course;
    
    const userId = user?.id;
    const email = user?.email;
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    
    if (!userId || !quiz?.id) {
        console.error('[WEBHOOK] Missing required fields for quiz.attempted');
        return;
    }

    await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

    // Normalize grade to percentage
    let gradePercent = null;
    if (typeof payload?.grade === 'number') {
        if (payload.grade <= 1) {
            // Treat as fraction: 1 → 100%, 0.5 → 50%
            gradePercent = payload.grade * 100;
        } else {
            // Already a percentage
            gradePercent = payload.grade;
        }
    }

    const activity = {
        thinkificUserId: userId,
        source: 'webhook',
        eventType: 'quiz_attempted',
        occurredAt,
        dedupeKey,
        webhookEventId: String(webhookId),
        courseId: course?.id || null,
        courseName: course?.name || null,
        lessonId: lesson?.id || null,
        lessonName: quiz?.name || null,
        attemptNumber: payload?.attempts || 1,
        grade: gradePercent,
        correctCount: typeof payload?.correct_count === 'number' ? payload.correct_count : (payload?.correct_count === true ? 1 : null),
        incorrectCount: typeof payload?.incorrect_count === 'number' ? payload.incorrect_count : null,
        studentEmail: (email || '').toLowerCase().trim(),
        studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
        rawPayload: JSON.stringify(rawBody)
    };

    const created = await base44.asServiceRole.entities.ActivityEvent.create(activity);
    console.log(`[WEBHOOK] ✓ Quiz attempted saved: ${created.id}, grade=${activity.grade}%`);
    
    // Trigger assignment completion check
    await base44.functions.invoke('markAssignmentComplete', { activityEventId: created.id });
}

async function handleUserSignin(base44, payload, webhookId, dedupeKey, occurredAt, rawBody) {
    const userId = payload?.id;
    const email = payload?.email;
    const firstName = payload?.first_name;
    const lastName = payload?.last_name;
    
    if (!userId || !email) {
        console.error('[WEBHOOK] Missing required fields for user.signin');
        return;
    }

    await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

    const activity = {
        thinkificUserId: userId,
        source: 'webhook',
        eventType: 'user_signin',
        occurredAt,
        dedupeKey,
        webhookEventId: String(webhookId),
        studentEmail: (email || '').toLowerCase().trim(),
        studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
        rawPayload: JSON.stringify(rawBody)
    };

    await base44.asServiceRole.entities.ActivityEvent.create(activity);
    console.log(`[WEBHOOK] ✓ User signin logged`);
}

async function handleEnrollmentCreated(base44, payload, webhookId, dedupeKey, occurredAt, rawBody) {
    const user = payload?.user;
    const course = payload?.course;
    const userId = user?.id;
    const email = user?.email;
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    
    if (!userId || !course?.id) {
        console.error('[WEBHOOK] Missing required fields for enrollment.created');
        return;
    }

    await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

    const activity = {
        thinkificUserId: userId,
        source: 'webhook',
        eventType: 'enrollment_created',
        occurredAt,
        dedupeKey,
        webhookEventId: String(webhookId),
        courseId: course?.id || null,
        courseName: course?.name || null,
        studentEmail: (email || '').toLowerCase().trim(),
        studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
        rawPayload: JSON.stringify(rawBody)
    };

    await base44.asServiceRole.entities.ActivityEvent.create(activity);
    console.log(`[WEBHOOK] ✓ Enrollment created logged`);
}

async function handleUserSignup(base44, payload, webhookId, dedupeKey, occurredAt, rawBody) {
    const userId = payload?.id;
    const email = payload?.email;
    const firstName = payload?.first_name;
    const lastName = payload?.last_name;
    
    if (!userId || !email) {
        console.error('[WEBHOOK] Missing required fields for user.signup');
        return;
    }

    await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

    const activity = {
        thinkificUserId: userId,
        source: 'webhook',
        eventType: 'user_signup',
        occurredAt,
        dedupeKey,
        webhookEventId: String(webhookId),
        studentEmail: (email || '').toLowerCase().trim(),
        studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
        rawPayload: JSON.stringify(rawBody)
    };

    await base44.asServiceRole.entities.ActivityEvent.create(activity);
    console.log(`[WEBHOOK] ✓ User signup logged`);
}

async function handleSubscriptionCanceled(base44, payload, webhookId) {
    const user = payload?.user;
    const email = user?.email;
    const userId = user?.id;
    
    if (!userId || !email) {
        console.error('[WEBHOOK] Missing required fields for subscription.canceled');
        return;
    }

    const existingAccess = await base44.asServiceRole.entities.TeacherAccess.filter({ 
        teacherEmail: email.toLowerCase().trim() 
    });

    if (existingAccess.length > 0) {
        await base44.asServiceRole.entities.TeacherAccess.update(existingAccess[0].id, {
            status: 'ended',
            lastWebhookId: String(webhookId)
        });
        console.log(`[WEBHOOK] ✓ TeacherAccess ended for ${email}`);
    }
}