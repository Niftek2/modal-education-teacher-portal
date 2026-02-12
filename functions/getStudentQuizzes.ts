import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ThinkificClient } from './lib/thinkificClient.js';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function createExternalId(userId, quizId, lessonId, createdAt) {
    const data = `${userId}-${quizId}-${lessonId || 'none'}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentId, sessionToken } = await req.json();
        
        await verifySession(sessionToken);

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        console.log(`[QUIZ HISTORY] Fetching for student: ${studentId}`);

        // Fetch quiz.attempted events from Thinkific
        const quizEvents = await ThinkificClient.getUserEvents(studentId, 'quiz.attempted');
        
        console.log(`[QUIZ HISTORY] Found ${quizEvents.length} quiz events`);

        // Check which already exist in DB
        const existingQuizzes = await base44.asServiceRole.entities.QuizCompletion.filter({
            studentId: String(studentId)
        });

        const existingExternalIds = new Set(existingQuizzes.map(q => q.externalId));
        
        // Convert events to QuizCompletion format and store new ones
        const newQuizzes = [];
        
        for (const event of quizEvents) {
            const payload = event.payload || {};
            
            // Create stable external ID for deduplication
            let externalId;
            if (payload.quiz_attempt?.id) {
                externalId = `quiz_attempt_${payload.quiz_attempt.id}`;
            } else {
                externalId = await createExternalId(
                    studentId,
                    payload.quiz_id || event.object_id,
                    payload.lesson_id,
                    event.occurred_at
                );
            }

            // Skip if already exists
            if (existingExternalIds.has(externalId)) {
                continue;
            }

            const score = payload.score ?? payload.quiz_attempt?.score ?? 0;
            const maxScore = payload.max_score ?? payload.quiz_attempt?.max_score ?? 100;
            const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

            newQuizzes.push({
                externalId,
                studentId: String(studentId),
                studentEmail: payload.email || '',
                studentName: `${payload.first_name || ''} ${payload.last_name || ''}`.trim(),
                quizId: String(payload.quiz_id || event.object_id || ''),
                quizName: payload.quiz_name || 'Unknown Quiz',
                courseId: String(payload.course_id || ''),
                courseName: payload.course_name || '',
                score,
                maxScore,
                percentage,
                attemptNumber: payload.attempt_number || 1,
                completedAt: event.occurred_at || new Date().toISOString(),
                timeSpentSeconds: payload.time_spent_seconds || 0
            });
        }

        // Store new quiz completions
        if (newQuizzes.length > 0) {
            await base44.asServiceRole.entities.QuizCompletion.bulkCreate(newQuizzes);
            console.log(`[QUIZ HISTORY] Stored ${newQuizzes.length} new quiz completions`);
        }

        // Fetch all quizzes from DB for this student
        const allQuizzes = await base44.asServiceRole.entities.QuizCompletion.filter({
            studentId: String(studentId)
        }, '-completedAt', 1000);

        // Format for UI
        const enrichedQuizzes = allQuizzes.map(quiz => ({
            id: quiz.id,
            quizTitle: quiz.quizName,
            courseId: quiz.courseId,
            courseTitle: quiz.courseName,
            score: quiz.score,
            maxScore: quiz.maxScore,
            percentage: quiz.percentage,
            attempt: quiz.attemptNumber,
            completedAt: quiz.completedAt,
            timeSpentSeconds: quiz.timeSpentSeconds
        }));

        // Get user data for lastLogin
        const userData = await ThinkificClient.getUserById(studentId);

        return Response.json({ 
            quizzes: enrichedQuizzes,
            lastLogin: userData?.last_login_at || null,
            accountCreated: userData?.created_at || null
        });

    } catch (error) {
        console.error('[QUIZ HISTORY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});