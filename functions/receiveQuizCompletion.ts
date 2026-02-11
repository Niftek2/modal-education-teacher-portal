import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        // Extract quiz completion data from Thinkific webhook
        const {
            user_id,
            user_email,
            user_first_name,
            user_last_name,
            quiz_id,
            quiz_name,
            course_id,
            course_name,
            score,
            max_score,
            attempt_number,
            completed_at,
            time_spent_seconds
        } = body;

        // Validate required fields
        if (!user_id || !quiz_id || !quiz_name || score === undefined || !max_score) {
            return Response.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        const percentage = Math.round((score / max_score) * 100);
        const studentName = `${user_first_name || ''} ${user_last_name || ''}`.trim();

        // Store quiz completion in database
        const quizCompletion = await base44.asServiceRole.entities.QuizCompletion.create({
            studentId: user_id,
            studentEmail: user_email,
            studentName: studentName,
            quizId: quiz_id,
            quizName: quiz_name,
            courseId: course_id,
            courseName: course_name,
            score: score,
            maxScore: max_score,
            percentage: percentage,
            attemptNumber: attempt_number || 1,
            completedAt: completed_at,
            timeSpentSeconds: time_spent_seconds || null
        });

        return Response.json({
            success: true,
            message: 'Quiz completion recorded',
            id: quizCompletion.id
        });

    } catch (error) {
        console.error('Quiz webhook error:', error);
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
});