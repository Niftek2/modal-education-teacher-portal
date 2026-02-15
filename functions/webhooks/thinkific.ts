// 🔒 PRODUCTION LOCKED – DO NOT MODIFY WITHOUT EXPLICIT APPROVAL

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
 * Extract student email from webhook payload (normalized: lowercase + trimmed)
 */
function extractStudentEmail(evt) {
    const email = evt?.payload?.user?.email || evt?.payload?.email || null;
    return email ? email.trim().toLowerCase() : null;
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
        const resource = String(evt.resource || 'unknown');
        const action = String(evt.action || 'unknown');
        const eventType = `${resource}.${action}`;
        webhookId = evt.id || crypto.randomUUID();
        
        console.log(`[WEBHOOK] Event: ${eventType}, ID: ${webhookId}, received: ${receivedAt}`);

        // Store raw webhook event immediately (append-only)
        await base44.asServiceRole.entities.WebhookEvent.create({
            webhookId: String(webhookId),
            topic: String(eventType),
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
            case 'subscription.canceled':
                await handleSubscriptionCanceled(base44, evt, webhookId);
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
    const dedupeKey = String(enrollmentId && lessonId ? `${enrollmentId}-${lessonId}` : webhookId);

    // Check if already exists
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ rawEventId: webhookId });
    if (existing.length > 0) {
        console.log('[WEBHOOK] ⚠️ Lesson completion already exists, skipping (duplicate)');
        return { status: 'duplicate' };
    }

    // Upsert lesson->course mapping
    if (lessonId && courseId && courseName) {
        try {
            const existing = await base44.asServiceRole.entities.LessonCourseMap.filter({ lessonId: String(lessonId) });
            if (existing.length > 0) {
                await base44.asServiceRole.entities.LessonCourseMap.update(existing[0].id, {
                    courseId: String(courseId),
                    courseName: courseName,
                    lastSeenAt: occurredAtIso
                });
                console.log(`[LESSON WEBHOOK] ✓ Updated LessonCourseMap: lesson=${lessonId}, course=${courseName}`);
            } else {
                await base44.asServiceRole.entities.LessonCourseMap.create({
                    lessonId: String(lessonId),
                    courseId: String(courseId),
                    courseName: courseName,
                    lastSeenAt: occurredAtIso
                });
                console.log(`[LESSON WEBHOOK] ✓ Created LessonCourseMap: lesson=${lessonId}, course=${courseName}`);
            }
        } catch (error) {
            console.error(`[LESSON WEBHOOK] ❌ Failed to upsert LessonCourseMap:`, error.message);
        }
    }

    try {
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(studentUserId || ''),
            thinkificUserId: studentUserId ? Number(studentUserId) : null,
            studentEmail: studentEmail,
            studentDisplayName: studentEmail.split('@')[0],
            courseId: String(courseId || ''),
            courseName: courseName || '',
            eventType: 'lesson_completed',
            contentId: String(lessonId),
            contentTitle: lessonName || 'Unknown Lesson',
            occurredAt: occurredAtIso,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(payload),
            dedupeKey: dedupeKey,
            metadata: { userId: studentUserId }
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
    let courseId = payload?.course?.id;
    let courseName = payload?.course?.name;
    const resultId = payload?.result_id;
    
    // Look up course name from LessonCourseMap using lesson ID
    if (!courseName && lessonId) {
        try {
            const mapping = await base44.asServiceRole.entities.LessonCourseMap.filter({ lessonId: String(lessonId) });
            if (mapping.length > 0) {
                courseId = mapping[0].courseId;
                courseName = mapping[0].courseName;
                console.log(`[QUIZ WEBHOOK] ✓ Found courseName from mapping: ${courseName}`);
            }
        } catch (error) {
            console.warn(`[QUIZ WEBHOOK] Could not lookup course mapping:`, error.message);
        }
    }
    
    // Extract and convert to numbers - use null if missing, never 0 as default
    const scorePercent = payload?.grade != null ? Number(payload.grade) : null;
    const correctCount = payload?.correct_count != null ? Number(payload.correct_count) : null;
    const incorrectCount = payload?.incorrect_count != null ? Number(payload.incorrect_count) : null;
    const attemptNumber = payload?.attempts != null ? Number(payload.attempts) : null;

    console.log(`[QUIZ WEBHOOK] Processing quiz.attempted: student=${studentEmail}, quiz=${quizId}, resultId=${resultId}, scorePercent=${scorePercent}`);

    if (!studentEmail || !quizId) {
        console.error('[QUIZ WEBHOOK] ❌ Missing required fields');
        return { status: 'error', reason: 'missing_fields' };
    }

    const occurredAt = extractOccurredAt(evt);
    const occurredAtIso = occurredAt.toISOString();
    
    // Use resultId for dedupe if available, otherwise webhookId
    const dedupeKey = resultId ? `quiz_attempted:${resultId}` : `quiz_attempted:${webhookId}`;

    // Check if already exists by dedupeKey OR by old format dedupeKey
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey: dedupeKey });
    const existingOldFormat = resultId ? await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey: String(resultId) }) : [];
    
    if (existing.length > 0 || existingOldFormat.length > 0) {
        console.log('[QUIZ WEBHOOK] ⚠️ Quiz attempt already exists (dedupe), skipping');
        return { status: 'duplicate' };
    }

    try {
        const created = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: String(studentUserId || ''),
            thinkificUserId: studentUserId ? Number(studentUserId) : null,
            studentEmail: studentEmail,
            studentDisplayName: studentEmail.split('@')[0],
            courseId: String(courseId || ''),
            courseName: courseName || '',
            eventType: 'quiz_attempted',
            contentId: String(quizId),
            contentTitle: quizName || 'Unknown Quiz',
            occurredAt: occurredAtIso,
            source: 'webhook',
            rawEventId: String(webhookId),
            rawPayload: JSON.stringify(payload),
            dedupeKey: dedupeKey,
            scorePercent: scorePercent,
            metadata: {
                userId: studentUserId,
                resultId: resultId ? String(resultId) : null,
                attemptNumber: attemptNumber,
                correctCount: correctCount,
                incorrectCount: incorrectCount
            }
        });

        console.log(`[QUIZ WEBHOOK] ✓ Quiz attempt saved: student=${studentEmail}, scorePercent=${scorePercent}, occurredAt=${occurredAtIso}`);
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
            thinkificUserId: studentUserId ? Number(studentUserId) : null,
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
            metadata: { userId: studentUserId }
        });

        console.log(`[WEBHOOK] ✓ User signin tracked: email=${studentEmail}, occurredAt=${occurredAtIso}`);
        return { status: 'logged', userId: studentUserId, email: studentEmail };
    } catch (error) {
        console.error(`[WEBHOOK] ❌ Failed to track signin:`, error);
        return { status: 'error', reason: error.message };
    }
}

async function handleSubscriptionCanceled(base44, evt, webhookId) {
    const { payload } = evt;
    const teacherEmail = (payload?.user?.email || '').trim().toLowerCase();
    const thinkificUserId = String(payload?.user?.id || '');
    const subscriptionId = String(payload?.id || '');

    console.log(`[WEBHOOK] Processing subscription.canceled: teacher=${teacherEmail}, subscriptionId=${subscriptionId}`);

    // Audit: Store event regardless
    try {
        await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: thinkificUserId,
            thinkificUserId: thinkificUserId ? Number(thinkificUserId) : null,
            studentEmail: teacherEmail,
            studentDisplayName: teacherEmail.split('@')[0],
            courseId: '',
            courseName: '',
            eventType: 'subscription_canceled',
            contentId: subscriptionId,
            contentTitle: 'Subscription Canceled',
            occurredAt: extractOccurredAt(evt).toISOString(),
            source: 'webhook',
            rawEventId: webhookId,
            rawPayload: JSON.stringify(payload),
            dedupeKey: `subscription_canceled:${subscriptionId}`,
            metadata: { subscriptionId }
        });
    } catch (error) {
        console.error('[WEBHOOK] ❌ Failed to audit subscription.canceled:', error);
    }

    // Only proceed for real teachers
    if (!teacherEmail || teacherEmail.endsWith('@modalmath.com')) {
        console.log('[WEBHOOK] ⚠️ Skipping: internal email');
        return { status: 'skipped', reason: 'internal_email' };
    }

    // Check if teacher has Classroom entitlement and group
    let teacherData = null;
    try {
        const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
        const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
        const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");

        // Fetch user enrollments
        const enrollmentsResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${thinkificUserId}`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        if (!enrollmentsResponse.ok) {
            console.error('[WEBHOOK] ❌ Failed to fetch teacher enrollments');
            return { status: 'error', reason: 'enrollment_check_failed' };
        }

        const enrollments = await enrollmentsResponse.json();
        const hasClassroom = enrollments.items?.some(e => String(e.product_id) === String(CLASSROOM_PRODUCT_ID));

        if (!hasClassroom) {
            console.log('[WEBHOOK] ⚠️ Teacher does not have Classroom bundle');
            return { status: 'skipped', reason: 'no_classroom_bundle' };
        }

        // Check for group
        const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
        if (teacherGroups.length === 0) {
            console.log('[WEBHOOK] ⚠️ Teacher has no group');
            return { status: 'skipped', reason: 'no_group' };
        }

        teacherData = {
            email: teacherEmail,
            groupId: teacherGroups[0].thinkificGroupId
        };

    } catch (error) {
        console.error('[WEBHOOK] ❌ Failed teacher validation:', error);
        return { status: 'error', reason: 'validation_failed' };
    }

    // Compute period end: now + 1 month
    const occurredAt = extractOccurredAt(evt);
    const periodEndAt = new Date(occurredAt);
    periodEndAt.setMonth(periodEndAt.getMonth() + 1);
    const periodEndAtIso = periodEndAt.toISOString();

    console.log(`[WEBHOOK] Computed period end: ${periodEndAtIso}`);

    // Upsert TeacherAccess
    try {
        const existingAccess = await base44.asServiceRole.entities.TeacherAccess.filter({ teacherEmail });
        
        if (existingAccess.length > 0) {
            await base44.asServiceRole.entities.TeacherAccess.update(existingAccess[0].id, {
                status: 'canceling',
                currentPeriodEndAt: periodEndAtIso,
                currentPeriodEndSource: 'fixed_plus_1_month',
                subscriptionId,
                lastWebhookId: webhookId
            });
            console.log('[WEBHOOK] ✓ Updated TeacherAccess');
        } else {
            await base44.asServiceRole.entities.TeacherAccess.create({
                teacherEmail,
                thinkificUserId,
                subscriptionId,
                status: 'canceling',
                currentPeriodEndAt: periodEndAtIso,
                currentPeriodEndSource: 'fixed_plus_1_month',
                lastWebhookId: webhookId
            });
            console.log('[WEBHOOK] ✓ Created TeacherAccess');
        }
    } catch (error) {
        console.error('[WEBHOOK] ❌ Failed to upsert TeacherAccess:', error);
        return { status: 'error', reason: 'teacher_access_failed' };
    }

    // Create ScheduledUnenrollment (idempotent)
    const dedupeKey = `scheduled_unenroll:${teacherEmail}:${periodEndAtIso}`;
    try {
        const existingJob = await base44.asServiceRole.entities.ScheduledUnenrollment.filter({ dedupeKey });
        
        if (existingJob.length > 0) {
            console.log('[WEBHOOK] ⚠️ Unenrollment job already scheduled');
            return { status: 'duplicate', dedupeKey };
        }

        await base44.asServiceRole.entities.ScheduledUnenrollment.create({
            dedupeKey,
            teacherEmail,
            groupId: teacherData.groupId,
            runAt: periodEndAtIso,
            status: 'scheduled',
            sourceWebhookId: webhookId
        });

        console.log(`[WEBHOOK] ✓ Scheduled unenrollment for ${periodEndAtIso}`);
        return { status: 'scheduled', runAt: periodEndAtIso };

    } catch (error) {
        console.error('[WEBHOOK] ❌ Failed to schedule unenrollment:', error);
        return { status: 'error', reason: 'schedule_failed' };
    }
}