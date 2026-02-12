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

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentId, sessionToken } = await req.json();
        
        await verifySession(sessionToken);

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        console.log(`[QUIZ HISTORY] Fetching from DB for student: ${studentId}`);

        // Fetch all quizzes from DB for this student (populated by webhooks + backfill)
        const allQuizzes = await base44.asServiceRole.entities.QuizCompletion.filter({
            studentId: String(studentId)
        }, '-completedAt', 1000);

        console.log(`[QUIZ HISTORY] Found ${allQuizzes.length} quiz completions in DB`);

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