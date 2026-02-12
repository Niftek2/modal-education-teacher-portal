import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
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

        console.log(`[ACTIVITY] Fetching activity for student: ${studentId}`);

        // Get quiz completions
        const quizzes = await base44.asServiceRole.entities.QuizCompletion.filter({
            studentId: String(studentId)
        }, '-completedAt', 1000);

        // Get lesson completions
        const lessons = await base44.asServiceRole.entities.LessonCompletion.filter({
            studentId: String(studentId)
        }, '-completedAt', 1000);

        console.log(`[ACTIVITY] Found ${quizzes.length} quizzes, ${lessons.length} lessons`);

        return Response.json({
            quizzes: quizzes.map(q => ({
                id: q.id,
                quizName: q.quizName,
                courseName: q.courseName,
                score: q.score,
                maxScore: q.maxScore,
                percentage: q.percentage,
                attemptNumber: q.attemptNumber,
                completedAt: q.completedAt,
                timeSpentSeconds: q.timeSpentSeconds
            })),
            lessons: lessons.map(l => ({
                id: l.id,
                lessonName: l.lessonName,
                courseName: l.courseName,
                completedAt: l.completedAt
            }))
        });

    } catch (error) {
        console.error('[ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});