import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function createExternalId(userId, quizId, lessonId, createdAt) {
    const data = `${userId}-${quizId}-${lessonId || 'none'}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function createLessonExternalId(userId, lessonId, courseId, createdAt) {
    const data = `${userId}-${lessonId}-${courseId || 'none'}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let webhookLogId = null;
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const topic = body.topic || req.headers.get('x-thinkific-topic');
        const webhookId = body.id || crypto.randomUUID();
        
        console.log(`[WEBHOOK] Received: ${topic} (ID: ${webhookId})`);

        // Store in debug log first
        const logEntry = await base44.asServiceRole.entities.WebhookEventLog.create({
            timestamp: new Date().toISOString(),
            topic: topic,
            rawPayload: JSON.stringify(body),
            status: 'ok'
        });
        webhookLogId = logEntry.id;

        // Store raw webhook event (append-only audit log)
        await base44.asServiceRole.entities.WebhookEvent.create({
            webhookId: String(webhookId),
            topic: topic,
            receivedAt: new Date().toISOString(),
            payloadJson: JSON.stringify(body)
        });

        // Process based on topic
        switch (topic) {
            case 'lesson.completed':
                await handleLessonCompleted(base44, body);
                break;
            case 'quiz.attempted':
                await handleQuizAttempted(base44, body);
                break;
            case 'user.signin':
                await handleUserSignin(base44, body);
                break;
            default:
                console.log(`[WEBHOOK] Unhandled topic: ${topic}`);
        }

        return Response.json({ success: true, webhookId });
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
        user_id, email, first_name, last_name,
        lesson_id, lesson_name,
        course_id, course_name,
        completed_at
    } = payload;

    if (!user_id || !lesson_id) {
        console.error('[WEBHOOK] Missing required fields for lesson.completed');
        return;
    }

    const occurredAt = completed_at || new Date().toISOString();

    // Create stable external ID
    const externalId = await createLessonExternalId(user_id, lesson_id, course_id, occurredAt);

    // Check if already exists by externalId
    const existing = await base44.asServiceRole.entities.LessonCompletion.filter({
        externalId
    });

    if (existing.length > 0) {
        console.log('[WEBHOOK] Lesson completion already exists, skipping');
        return;
    }

    await base44.asServiceRole.entities.LessonCompletion.create({
        externalId,
        studentId: String(user_id),
        studentEmail: email,
        studentName: `${first_name || ''} ${last_name || ''}`.trim(),
        lessonId: String(lesson_id),
        lessonName: lesson_name || 'Unknown Lesson',
        courseId: String(course_id || ''),
        courseName: course_name || '',
        completedAt: occurredAt
    });

    console.log(`[WEBHOOK] Lesson completion recorded: ${lesson_name}`);
}

async function handleQuizAttempted(base44, payload) {
    const {
        user_id, email, first_name, last_name,
        quiz_id, quiz_name, lesson_id,
        course_id, course_name,
        score, max_score, percentage_score,
        attempt_number, completed_at, time_spent_seconds,
        quiz_attempt
    } = payload;

    if (!user_id || !quiz_id || score === undefined || !max_score) {
        console.error('[WEBHOOK] Missing required fields for quiz.attempted');
        return;
    }

    const percentage = percentage_score || Math.round((score / max_score) * 100);
    const occurredAt = completed_at || new Date().toISOString();

    // Create stable external ID
    let externalId;
    if (quiz_attempt?.id) {
        externalId = `quiz_attempt_${quiz_attempt.id}`;
    } else {
        externalId = await createExternalId(user_id, quiz_id, lesson_id, occurredAt);
    }

    // Check if already exists by externalId
    const existing = await base44.asServiceRole.entities.QuizCompletion.filter({
        externalId
    });

    if (existing.length > 0) {
        console.log('[WEBHOOK] Quiz attempt already exists, skipping');
        return;
    }

    await base44.asServiceRole.entities.QuizCompletion.create({
        externalId,
        studentId: String(user_id),
        studentEmail: email,
        studentName: `${first_name || ''} ${last_name || ''}`.trim(),
        quizId: String(quiz_id),
        quizName: quiz_name || 'Unknown Quiz',
        courseId: String(course_id || ''),
        courseName: course_name || '',
        score,
        maxScore: max_score,
        percentage,
        attemptNumber: attempt_number || 1,
        completedAt: occurredAt,
        timeSpentSeconds: time_spent_seconds || 0
    });

    console.log(`[WEBHOOK] Quiz attempt recorded: ${quiz_name} - ${percentage}%`);
}

async function handleUserSignin(base44, payload) {
    const { user_id, email, occurred_at } = payload;

    if (!user_id || !email) {
        console.error('[WEBHOOK] Missing required fields for user.signin');
        return;
    }

    // Update last login tracking (could be in a separate entity or User entity)
    console.log(`[WEBHOOK] User signin: ${email} at ${occurred_at}`);
    
    // For now, we'll rely on the getStudents function fetching this via API
    // Alternatively, create a UserSignin entity to track all logins
}