import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        
        const topic = body.topic || req.headers.get('x-thinkific-topic');
        const webhookId = body.id || crypto.randomUUID();
        
        console.log(`[WEBHOOK] Received: ${topic} (ID: ${webhookId})`);

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

    // Check if already exists (idempotency)
    const existing = await base44.asServiceRole.entities.LessonCompletion.filter({
        studentId: String(user_id),
        lessonId: String(lesson_id),
        completedAt: completed_at
    });

    if (existing.length > 0) {
        console.log('[WEBHOOK] Lesson completion already exists, skipping');
        return;
    }

    await base44.asServiceRole.entities.LessonCompletion.create({
        studentId: String(user_id),
        studentEmail: email,
        studentName: `${first_name || ''} ${last_name || ''}`.trim(),
        lessonId: String(lesson_id),
        lessonName: lesson_name || 'Unknown Lesson',
        courseId: String(course_id || ''),
        courseName: course_name || '',
        completedAt: completed_at || new Date().toISOString()
    });

    console.log(`[WEBHOOK] Lesson completion recorded: ${lesson_name}`);
}

async function handleQuizAttempted(base44, payload) {
    const {
        user_id, email, first_name, last_name,
        quiz_id, quiz_name,
        course_id, course_name,
        score, max_score, percentage_score,
        attempt_number, completed_at, time_spent_seconds
    } = payload;

    if (!user_id || !quiz_id || score === undefined || !max_score) {
        console.error('[WEBHOOK] Missing required fields for quiz.attempted');
        return;
    }

    const percentage = percentage_score || Math.round((score / max_score) * 100);

    // Check if already exists (idempotency by user+quiz+attempt+time)
    const existing = await base44.asServiceRole.entities.QuizCompletion.filter({
        studentId: String(user_id),
        quizId: String(quiz_id),
        attemptNumber: attempt_number || 1,
        completedAt: completed_at
    });

    if (existing.length > 0) {
        console.log('[WEBHOOK] Quiz attempt already exists, skipping');
        return;
    }

    await base44.asServiceRole.entities.QuizCompletion.create({
        studentId: String(user_id),
        studentEmail: email,
        studentName: `${first_name || ''} ${last_name || ''}`.trim(),
        quizId: String(quiz_id),
        quizName: quiz_name || 'Unknown Quiz',
        courseId: String(course_id || ''),
        courseName: course_name || '',
        score: score,
        maxScore: max_score,
        percentage: percentage,
        attemptNumber: attempt_number || 1,
        completedAt: completed_at || new Date().toISOString(),
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