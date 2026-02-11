import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
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

async function getQuizAttempts(userId) {
    try {
        console.log('Fetching quiz attempts for user:', userId);
        // Try quiz_attempts (note: singular) instead of quizzes_attempts
        const response = await fetch(`https://api.thinkific.com/api/public/v1/quiz_attempts?query[user_id]=${userId}`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });

        console.log('Quiz attempts response status:', response.status);
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to fetch quiz attempts:', response.status, errorText);
            return [];
        }

        const data = await response.json();
        console.log('Quiz attempts data items:', data.items?.length || 0);
        return data.items || [];
    } catch (error) {
        console.error('Quiz attempts fetch error:', error);
        return [];
    }
}

async function getUserData(userId) {
    try {
        console.log('Fetching user data for user:', userId);
        const response = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });

        console.log('User data response status:', response.status);
        if (!response.ok) {
            console.error('Failed to fetch user data:', response.status);
            return null;
        }

        const data = await response.json();
        console.log('User data:', { last_login_at: data.last_login_at, created_at: data.created_at });
        return data;
    } catch (error) {
        console.error('User data fetch error:', error);
        return null;
    }
}

Deno.serve(async (req) => {
    try {
        const { studentId, sessionToken } = await req.json();
        console.log('Request received for student:', studentId);
        
        await verifySession(sessionToken);

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        // Fetch quiz attempts and user data in parallel
        const [quizAttempts, userData] = await Promise.all([
            getQuizAttempts(studentId),
            getUserData(studentId)
        ]);

        const enrichedQuizzes = quizAttempts.map((quiz) => ({
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
        })).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

        console.log('Returning quizzes:', enrichedQuizzes.length);

        return Response.json({ 
            quizzes: enrichedQuizzes,
            lastLogin: userData?.last_login_at || null,
            accountCreated: userData?.created_at || null
        });

    } catch (error) {
        console.error('Get student quizzes error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});