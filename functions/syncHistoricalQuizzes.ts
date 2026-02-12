import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");

async function queryThinkificGraphQL(query, variables) {
    const response = await fetch(`https://${THINKIFIC_SUBDOMAIN}.thinkific.com/graphql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': THINKIFIC_API_KEY,
        },
        body: JSON.stringify({ query, variables }),
    });

    const data = await response.json();
    
    if (data.errors) {
        console.error('GraphQL errors:', data.errors);
        throw new Error(`GraphQL error: ${data.errors[0]?.message}`);
    }

    return data.data;
}

async function getHistoricalQuizAttempts(userId) {
    const query = `
        query GetUserQuizAttempts($userId: ID!) {
            user(id: $userId) {
                quizAttempts {
                    edges {
                        node {
                            id
                            quiz {
                                id
                                name
                            }
                            course {
                                id
                                name
                            }
                            score
                            maxScore
                            percentageScore
                            attemptNumber
                            completedAt
                            timeSpentSeconds
                            user {
                                id
                                firstName
                                lastName
                                email
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const result = await queryThinkificGraphQL(query, { userId });
        const attempts = result?.user?.quizAttempts?.edges?.map(edge => edge.node) || [];
        console.log(`Retrieved ${attempts.length} quiz attempts for user ${userId}`);
        return attempts;
    } catch (error) {
        console.error(`Error fetching quiz attempts for user ${userId}:`, error);
        return [];
    }
}

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
            const attempts = await getHistoricalQuizAttempts(student.id);
            allQuizAttempts.push(...attempts);
        }

        console.log(`Total quiz attempts to sync: ${allQuizAttempts.length}`);

        // Transform and store in Base44
        const quizCompletions = allQuizAttempts.map((attempt) => ({
            studentId: attempt.user.id,
            studentEmail: attempt.user.email,
            studentName: `${attempt.user.firstName} ${attempt.user.lastName}`,
            quizId: attempt.quiz.id,
            quizName: attempt.quiz.name,
            courseId: attempt.course.id,
            courseName: attempt.course.name,
            score: attempt.score,
            maxScore: attempt.maxScore,
            percentage: attempt.percentageScore,
            attemptNumber: attempt.attemptNumber || 1,
            completedAt: attempt.completedAt,
            timeSpentSeconds: attempt.timeSpentSeconds,
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