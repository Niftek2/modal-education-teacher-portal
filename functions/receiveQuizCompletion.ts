import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        // Thinkific nests all event data inside body.payload
        const data = body.payload;

        if (!data || !data.user || !data.quiz) {
            return Response.json({ error: 'Invalid payload structure' }, { status: 400 });
        }

        const { score, max_score, completed_at, attempt_number, time_spent_seconds } = data;
        const { id: user_id, email: user_email, first_name, last_name } = data.user;
        const { id: quiz_id, name: quiz_name } = data.quiz;
        const chapter_name = data.chapter?.name || '';
        const course_id = data.course?.id;
        const course_name = data.course?.name;

        if (!quiz_id || !quiz_name || score === undefined || !max_score) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const percentage = Math.round((score / max_score) * 100);
        const studentName = `${first_name || ''} ${last_name || ''}`.trim();

        // Store quiz completion in database
        const quizCompletion = await base44.asServiceRole.entities.QuizCompletion.create({
            studentId: String(user_id || ''),
            studentEmail: user_email || '',
            studentName: studentName,
            quizId: String(quiz_id),
            quizName: quiz_name,
            courseId: course_id ? String(course_id) : '',
            courseName: course_name || '',
            score: score,
            maxScore: max_score,
            percentage: percentage,
            attemptNumber: attempt_number || 1,
            completedAt: completed_at || new Date().toISOString(),
            timeSpentSeconds: time_spent_seconds || null
        });

        // Auto-complete matching StudentAssignment (keyed by email + quizId)
        if (user_email) {
            const normalizedEmail = user_email.trim().toLowerCase();
            const matchingAssignments = await base44.asServiceRole.entities.StudentAssignment.filter({
                studentEmail: normalizedEmail,
                quizId: String(quiz_id),
                status: 'assigned'
            });

            for (const assignment of matchingAssignments) {
                await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                    status: 'completed',
                    title: quiz_name,
                    topic: chapter_name,
                    completedAt: completed_at || new Date().toISOString(),
                    completedByEventId: quizCompletion.id,
                    metadata: { ...(assignment.metadata || {}), grade: percentage, quizName: quiz_name, chapterName: chapter_name }
                });
            }

            console.log(`[receiveQuizCompletion] Marked ${matchingAssignments.length} assignment(s) complete for ${normalizedEmail} quiz ${quiz_id}`);
        }

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