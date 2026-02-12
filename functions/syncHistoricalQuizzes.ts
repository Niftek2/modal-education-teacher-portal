import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");

async function getGroupStudents(groupId) {
    const response = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[group_id]=${groupId}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch group members: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
}

async function getQuizAttempts(userId) {
    const response = await fetch(
        `https://api.thinkific.com/api/public/v1/quiz_attempts?query[user_id]=${userId}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        console.error(`Failed to fetch quiz attempts for user ${userId}: ${response.status}`);
        return [];
    }

    const data = await response.json();
    return data.items || [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId } = await req.json();

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        // Get all students in the group
        const groupStudents = await getGroupStudents(groupId);
        console.log(`Syncing quiz data for ${groupStudents.length} students`);

        // Fetch quiz attempts for each student
        const allQuizAttempts = [];
        for (const student of groupStudents) {
            const attempts = await getQuizAttempts(student.id);
            allQuizAttempts.push(...attempts.map(a => ({...a, student})));
        }

        console.log(`Total quiz attempts to sync: ${allQuizAttempts.length}`);

        // Transform and store in Base44
        const quizCompletions = allQuizAttempts.map((attempt) => ({
            studentId: String(attempt.student.id),
            studentEmail: attempt.student.email,
            studentName: `${attempt.student.first_name} ${attempt.student.last_name}`,
            quizId: String(attempt.quiz_id),
            quizName: attempt.quiz_name || 'Unknown Quiz',
            courseId: String(attempt.course_id || ''),
            courseName: attempt.course_name || '',
            score: attempt.score || 0,
            maxScore: attempt.max_score || 0,
            percentage: attempt.percentage_score || 0,
            attemptNumber: attempt.attempt_number || 1,
            completedAt: attempt.completed_at || new Date().toISOString(),
            timeSpentSeconds: attempt.time_spent_seconds || 0,
        }));

        // Bulk create quiz completions
        if (quizCompletions.length > 0) {
            await base44.asServiceRole.entities.QuizCompletion.bulkCreate(quizCompletions);
            console.log(`Successfully synced ${quizCompletions.length} quiz completions`);
        }

        return Response.json({
            success: true,
            synced: quizCompletions.length,
            message: `Synced ${quizCompletions.length} quiz attempts for ${groupStudents.length} students`,
        });
    } catch (error) {
        console.error('Sync historical quizzes error:', error);
        return Response.json(
            { error: error.message || 'Failed to sync quiz data' },
            { status: 500 }
        );
    }
});