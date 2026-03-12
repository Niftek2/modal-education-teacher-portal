import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * PRODUCTION LOCKED: Primary webhook ingestion endpoint
 * Normalizes all Thinkific webhooks into ActivityEvent table
 * Idempotent by webhook event ID
 */

const COURSE_LEVEL_MAP = {
    '422595': 'PK',
    '422618': 'K',
    '422620': 'L1',
    '496294': 'L2',
    '496295': 'L3',
    '496297': 'L4',
    '496298': 'L5',
};

function inferLevel(courseId, name) {
    if (courseId && COURSE_LEVEL_MAP[String(courseId)]) return COURSE_LEVEL_MAP[String(courseId)];
    if (!name) return null;
    if (/\bPK\b/i.test(name)) return 'PK';
    if (/\bL5\b/i.test(name)) return 'L5';
    if (/\bL4\b/i.test(name)) return 'L4';
    if (/\bL3\b/i.test(name)) return 'L3';
    if (/\bL2\b/i.test(name)) return 'L2';
    if (/\bL1\b/i.test(name)) return 'L1';
    if (/\bK\b/i.test(name)) return 'K';
    return null;
}

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
        
        // Email extraction: lesson.completed/quiz.attempted use payload.user.email;
        // user.signin/user.signup use payload.email directly (no nested user object).
        const webhookStudentEmail = (payload?.user?.email || payload?.email || '').toLowerCase().trim();
        console.log(`[WEBHOOK] Email resolved: "${webhookStudentEmail}" from payload.user.email="${payload?.user?.email}" | payload.email="${payload?.email}"`);
        if (webhookStudentEmail === 'azizae414@modalmath.com') {
            console.log(`[WEBHOOK DEBUG AZIZA] EventType=${eventType}, WebhookId=${webhookId}, UserId=${payload?.user?.id}, QuizId=${payload?.quiz?.id}, CourseId=${payload?.course?.id}, Email=${webhookStudentEmail}`);
        }

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
        } else if (eventType === 'quiz_attempt.created') {
            // Alternate event type for quiz attempts — route to same handler
            await handleQuizAttempted(base44, payload, webhookId, dedupeKey, occurredAt, body);
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
    
    // Skip Quiz type lessons
    if (lesson?.type === 'Quiz') {
        console.log(`[WEBHOOK] Skipping lesson.completed for lesson ID ${lesson?.id} (type: Quiz)`);
        return;
    }
    
    if (!userId || !lesson?.id || !email) {
        console.error('[WEBHOOK] Missing required fields for lesson.completed: userId, lessonId, or email');
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
        lessonType: lesson?.type || null,
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
    const email = (user?.email || '').toLowerCase().trim();
    const firstName = user?.first_name;
    const lastName = user?.last_name;
    
    if (!userId || !quiz?.id || !email) {
        console.error('[WEBHOOK] Missing required fields for quiz.attempted: userId, quizId, or email');
        return;
    }

    await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

    const grade = payload.grade;
    const quizName = quiz.name || payload.name || null;
    const attemptNumber = payload.attempts;
    const correctCount = payload.correct_count;
    const incorrectCount = payload.incorrect_count;
    const courseId = course?.id || payload.course_id || null;

    // Map courseId → level label (absolute source of truth)
    const level = inferLevel(courseId, quizName);
    // courseName = the quiz topic name (NOT the level code); level is stored separately
    const courseName = quizName || course?.name || null;

    // Secondary dedupe: email+quizId+courseId+timestamp
    const secondaryKey = `quiz:${email}:${quiz.id}:${courseId || 'x'}:${occurredAt}`;
    const secondaryExisting = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey: secondaryKey });
    if (secondaryExisting.length > 0) {
        console.log(`[WEBHOOK] Secondary dedupe hit for quiz ${quiz.id}, skipping`);
        return;
    }

    // Normalize grade to percentage — handle number or string, fallback to correct/total
    let gradePercent = null;
    if (grade != null) {
        const numGrade = typeof grade === 'string' ? parseFloat(grade) : grade;
        if (!isNaN(numGrade)) {
            gradePercent = (numGrade > 0 && numGrade <= 1) ? Math.round(numGrade * 100) : numGrade;
        }
    }
    if (gradePercent == null && typeof correctCount === 'number' && typeof incorrectCount === 'number') {
        const total = correctCount + incorrectCount;
        if (total > 0) gradePercent = Math.round((correctCount / total) * 100);
    }

    const activity = {
        thinkificUserId: userId,
        source: 'webhook',
        eventType: 'quiz_attempted',
        occurredAt,
        dedupeKey,
        webhookEventId: String(webhookId),
        courseId: courseId ? Number(courseId) : null,
        courseName,
        lessonId: lesson?.id || null,
        lessonName: quizName,
        attemptNumber,
        grade: gradePercent,
        correctCount,
        incorrectCount,
        studentEmail: email,
        studentDisplayName: `${firstName || ''} ${lastName || ''}`.trim(),
        rawPayload: JSON.stringify(rawBody),
        level: level || null,
    };

    console.log(`[WEBHOOK] Quiz data: name="${quizName}", grade=${gradePercent}%, attempt=${attemptNumber}, courseId=${courseId}, level/courseName=${courseName}`);

    const created = await base44.asServiceRole.entities.ActivityEvent.create(activity);
    console.log(`[WEBHOOK] ✓ Quiz attempted saved: ${created.id}`);

    // Update StudentProfile level only if it has changed (avoids redundant DB writes)
    if (level) {
        try {
            const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ thinkificUserId: userId });
            if (profiles.length > 0 && profiles[0].level !== level) {
                await base44.asServiceRole.entities.StudentProfile.update(profiles[0].id, { level });
                console.log(`[WEBHOOK] ✓ StudentProfile level updated: userId=${userId} ${profiles[0].level || 'null'} → ${level}`);
            }
        } catch (profileErr) {
            console.warn(`[WEBHOOK] StudentProfile level update failed: ${profileErr.message}`);
        }
    }

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

const YOUR_CLASSROOM_COURSE_ID = 552235;

async function createThinkificClassroomGroup(userId, firstName, lastName, email) {
    const subdomain = Deno.env.get('THINKIFIC_SUBDOMAIN');
    const token = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
    const headers = {
        'Authorization': `Bearer ${token}`,
        'X-Auth-Subdomain': subdomain,
        'Content-Type': 'application/json'
    };

    const groupName = (firstName && lastName)
        ? `${firstName} ${lastName}'s Classroom`
        : `${email}'s Classroom`;

    // Check if group already exists
    const searchRes = await fetch(
        `https://api.thinkific.com/api/public/v1/groups?query[name]=${encodeURIComponent(groupName)}`,
        { headers }
    );
    const searchData = await searchRes.json();
    const existingGroup = (searchData.items || []).find(g => g.name === groupName);

    let groupId;
    if (existingGroup) {
        groupId = existingGroup.id;
        console.log(`[WEBHOOK] Group already exists: "${groupName}" (id=${groupId})`);
    } else {
        const createRes = await fetch('https://api.thinkific.com/api/public/v1/groups', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: groupName })
        });
        const createData = await createRes.json();
        groupId = createData.id;
        console.log(`[WEBHOOK] ✓ Created group: "${groupName}" (id=${groupId})`);
    }

    if (!groupId) {
        console.error(`[WEBHOOK] Failed to get/create group for "${groupName}"`);
        return null;
    }

    // Add user to group
    const addRes = await fetch('https://api.thinkific.com/api/public/v1/group_users', {
        method: 'POST',
        headers,
        body: JSON.stringify({ group_id: groupId, user_id: userId })
    });

    if (addRes.ok) {
        console.log(`[WEBHOOK] ✓ Added user ${userId} to group ${groupId}`);
    } else {
        const errBody = await addRes.text();
        console.log(`[WEBHOOK] Add user to group response (${addRes.status}): ${errBody}`);
    }

    return { groupId, groupName };
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

    // Auto-create Thinkific group when enrolling in "Your Classroom"
    if (Number(course?.id) === YOUR_CLASSROOM_COURSE_ID) {
        if (!email) {
            console.error('[WEBHOOK] Missing email for Your Classroom group creation, skipping');
            return;
        }
        console.log(`[WEBHOOK] Your Classroom enrollment detected for ${email}, creating group...`);
        await createThinkificClassroomGroup(userId, firstName, lastName, email);
    }
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