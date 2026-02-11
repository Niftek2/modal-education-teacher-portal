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
    const response = await fetch(`https://api.thinkific.com/api/public/v1/quiz_results?query[user_id]=${userId}&limit=100`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error('Quiz results error:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('Response:', errorText);
        return [];
    }

    const data = await response.json();
    console.log('Quiz results raw:', data);
    return data.items || [];
}

Deno.serve(async (req) => {
    try {
        const { studentId, sessionToken } = await req.json();
        await verifySession(sessionToken);

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        const quizResults = await getQuizResults(studentId);

        const enrichedQuizzes = quizResults.map((quiz) => {
            const courseTitle = quiz.quiz?.course?.name || 'Unknown Course';
            const quizTitle = quiz.quiz?.name || 'Unknown Quiz';
            return {
                id: quiz.id,
                quizTitle: quizTitle,
                courseId: quiz.quiz?.course?.id,
                courseTitle: courseTitle,
                score: quiz.score,
                maxScore: quiz.maxScore,
                percentage: quiz.maxScore ? Math.round((quiz.score / quiz.maxScore) * 100) : 0,
                attempt: quiz.attempt || 1,
                completedAt: quiz.completedAt,
                timeSpentSeconds: quiz.spentSeconds || null
            };
        });

        return Response.json({ quizzes: enrichedQuizzes });

    } catch (error) {
        console.error('Get student quizzes error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});