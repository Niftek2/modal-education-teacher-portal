import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    try {
        const secret = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret);
        return payload;
    } catch (error) {
        console.error('Token verification failed:', error.message);
        throw new Error('Invalid session token');
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentId, sessionToken } = await req.json();
        await verifySession(sessionToken);

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        console.log('Fetching quizzes for student:', studentId);

        // Query the QuizCompletion entity from the database
        const quizCompletions = await base44.asServiceRole.entities.QuizCompletion.filter({
            studentId: studentId
        });

        console.log('Found quiz completions:', quizCompletions.length);

        const enrichedQuizzes = quizCompletions.map((quiz) => ({
            id: quiz.id,
            quizTitle: quiz.quizName || 'Unknown Quiz',
            courseId: quiz.courseId,
            courseTitle: quiz.courseName || 'Unknown Course',
            score: quiz.score,
            maxScore: quiz.maxScore,
            percentage: quiz.percentage || 0,
            attempt: quiz.attemptNumber || 1,
            completedAt: quiz.completedAt,
            timeSpentSeconds: quiz.timeSpentSeconds || null
        })).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

        return Response.json({ quizzes: enrichedQuizzes });

    } catch (error) {
        console.error('Get student quizzes error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});