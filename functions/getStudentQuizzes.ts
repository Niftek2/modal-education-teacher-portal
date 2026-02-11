import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

async function getQuizResults(userId) {
    try {
        const response = await fetch(`https://api.thinkific.com/api/public/v1/quiz_results?query[user_id]=${userId}&limit=100`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Quiz results fetch error:', response.status);
            return [];
        }

        const data = await response.json();
        console.log('Quiz results:', data);
        
        return data.items || [];
    } catch (error) {
        console.error('Quiz fetch error:', error);
        return [];
    }
}

Deno.serve(async (req) => {
    try {
        const { studentId, sessionToken } = await req.json();
        await verifySession(sessionToken);

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        const quizResults = await getQuizResults(studentId);

        const enrichedQuizzes = quizResults.map((quiz) => ({
            id: quiz.id,
            quizTitle: quiz.quiz_name || 'Unknown Quiz',
            courseId: quiz.course_id,
            courseTitle: quiz.course_name || 'Unknown Course',
            score: quiz.score,
            maxScore: quiz.max_score,
            percentage: quiz.max_score ? Math.round((quiz.score / quiz.max_score) * 100) : 0,
            attempt: quiz.attempt_number || 1,
            completedAt: quiz.completed_at,
            timeSpentSeconds: quiz.time_spent_seconds || null
        }));

        return Response.json({ quizzes: enrichedQuizzes });

    } catch (error) {
        console.error('Get student quizzes error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});