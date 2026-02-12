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
            topic: topic,
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

    // Create stable external ID
    const externalId = await createLessonExternalId(user_id, lesson_id, course_id, occurredAt);

    // Check if already exists by externalId
    const existing = await base44.asServiceRole.entities.LessonCompletion.filter({
        externalId
    });

    if (existing.length > 0) {
        console.log('[WEBHOOK] ⚠️ Lesson completion already exists, skipping (duplicate)');
        return { status: 'duplicate', externalId };
    }

    try {
        const created = await base44.asServiceRole.entities.LessonCompletion.create({
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

        console.log(`[WEBHOOK] ✓ Lesson completion saved: DB ID=${created.id}, externalId=${externalId}`);
        return { status: 'created', id: created.id, externalId };
    } catch (error) {
        console.error(`[WEBHOOK] ❌ Failed to save lesson completion:`, error);
        throw error;
    }
}

async function handleQuizAttempted(base44, payload) {
    console.log(`[QUIZ WEBHOOK] ========== QUIZ.ATTEMPTED ==========`);
    console.log(`[QUIZ WEBHOOK] Full payload:`, JSON.stringify(payload, null, 2));
    
    const {
        user_id, email, first_name, last_name,
        quiz_id, quiz_name, lesson_id,
        course_id, course_name,
        score, max_score, percentage_score,
        attempt_number, completed_at, time_spent_seconds,
        quiz_attempt
    } = payload;

    console.log(`[QUIZ WEBHOOK] Extracted fields:`);
    console.log(`[QUIZ WEBHOOK]   user_id: ${user_id}`);
    console.log(`[QUIZ WEBHOOK]   email: ${email}`);
    console.log(`[QUIZ WEBHOOK]   quiz_id: ${quiz_id}`);
    console.log(`[QUIZ WEBHOOK]   quiz_name: ${quiz_name}`);
    console.log(`[QUIZ WEBHOOK]   score: ${score}`);
    console.log(`[QUIZ WEBHOOK]   max_score: ${max_score}`);
    console.log(`[QUIZ WEBHOOK]   lesson_id: ${lesson_id}`);

    if (!user_id || !quiz_id || score === undefined || !max_score) {
        console.error('[QUIZ WEBHOOK] ❌ VALIDATION FAILED - Missing required fields');
        console.error(`[QUIZ WEBHOOK]   user_id present: ${!!user_id}`);
        console.error(`[QUIZ WEBHOOK]   quiz_id present: ${!!quiz_id}`);
        console.error(`[QUIZ WEBHOOK]   score present: ${score !== undefined}`);
        console.error(`[QUIZ WEBHOOK]   max_score present: ${!!max_score}`);
        return { status: 'error', reason: 'missing_fields' };
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
        console.log('[WEBHOOK] ⚠️ Quiz attempt already exists, skipping (duplicate)');
        return { status: 'duplicate', externalId };
    }

    const recordToCreate = {
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
    };
    
    console.log(`[QUIZ WEBHOOK] About to create DB record:`, JSON.stringify(recordToCreate, null, 2));
    
    try {
        const created = await base44.asServiceRole.entities.QuizCompletion.create(recordToCreate);

        console.log(`[QUIZ WEBHOOK] ✓✓✓ SUCCESS - Quiz attempt saved to DB`);
        console.log(`[QUIZ WEBHOOK]   DB ID: ${created.id}`);
        console.log(`[QUIZ WEBHOOK]   externalId: ${externalId}`);
        console.log(`[QUIZ WEBHOOK]   score: ${percentage}%`);
        console.log(`[QUIZ WEBHOOK] ==========================================`);
        return { status: 'created', id: created.id, externalId, score: percentage };
    } catch (error) {
        console.error(`[QUIZ WEBHOOK] ❌❌❌ FATAL ERROR - Failed to save quiz attempt:`, error);
        console.error(`[QUIZ WEBHOOK] Error details:`, error.message);
        console.error(`[QUIZ WEBHOOK] Error stack:`, error.stack);
        throw error;
    }
}

async function handleUserSignin(base44, payload) {
    const { user_id, email, occurred_at } = payload;

    console.log(`[WEBHOOK] Processing user.signin for user ${user_id}, email ${email}`);

    if (!user_id || !email) {
        console.error('[WEBHOOK] ❌ Missing required fields for user.signin');
        return { status: 'error', reason: 'missing_fields' };
    }

    console.log(`[WEBHOOK] ✓ User signin tracked: user=${user_id}, email=${email}, time=${occurred_at}`);
    
    // Login tracking handled by getStudents function via Thinkific API
    return { status: 'logged', userId: user_id, email };
}