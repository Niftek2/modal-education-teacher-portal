import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");

async function createExternalId(userId: string, quizId: string, attemptId: string, createdAt: string) {
    const data = `${userId}-${quizId}-${attemptId}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function queryGraphQL(query: string, variables: any = {}) {
    const url = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/api/public/v1/graphql`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        },
        body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GraphQL request failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    
    if (result.errors) {
        console.error('[GRAPHQL] Errors:', JSON.stringify(result.errors));
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
}

async function getStudentQuizResults(userId: string) {
    const query = `
        query GetUserQuizResults($userId: ID!, $cursor: String) {
            user(id: $userId) {
                id
                email
                firstName
                lastName
                quizAttempts(first: 100, after: $cursor) {
                    edges {
                        node {
                            id
                            score
                            maxScore
                            percentageScore
                            attemptNumber
                            completedAt
                            timeSpent
                            quiz {
                                id
                                name
                                lesson {
                                    id
                                    name
                                }
                            }
                            course {
                                id
                                name
                            }
                        }
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        }
    `;

    let allAttempts: any[] = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
        const data = await queryGraphQL(query, { userId, cursor });
        
        if (!data?.user?.quizAttempts) {
            console.log(`[GRAPHQL] No quiz attempts found for user ${userId}`);
            break;
        }

        const { edges, pageInfo } = data.user.quizAttempts;
        allAttempts = allAttempts.concat(edges.map((edge: any) => edge.node));
        
        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;
    }

    return {
        user: data?.user,
        attempts: allAttempts
    };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { groupId } = await req.json();

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log(`[GRAPHQL BACKFILL] Starting for group ${groupId}`);

        // Get all students in group via REST API
        const groupUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/api/public/v1/group_users?group_id=${groupId}&limit=250`;
        const groupResponse = await fetch(groupUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        });

        const groupData = await groupResponse.json();
        const allUsers = groupData.items || [];
        const students = allUsers.filter((u: any) => u.email?.toLowerCase().endsWith('@modalmath.com'));

        console.log(`[GRAPHQL BACKFILL] Found ${students.length} students to process`);

        let totalQuizzesAdded = 0;
        let totalQuizzesSkipped = 0;
        let studentsProcessed = 0;
        let errors: any[] = [];

        for (const student of students) {
            studentsProcessed++;
            console.log(`[GRAPHQL BACKFILL] Processing ${studentsProcessed}/${students.length}: ${student.email}`);

            try {
                const { user: userData, attempts } = await getStudentQuizResults(student.id);

                console.log(`[GRAPHQL BACKFILL] Found ${attempts.length} quiz attempts for ${student.email}`);

                for (const attempt of attempts) {
                    // Create stable external ID
                    const externalId = await createExternalId(
                        String(student.id),
                        String(attempt.quiz?.id || 'unknown'),
                        String(attempt.id),
                        attempt.completedAt
                    );

                    // Check if already exists
                    const existing = await base44.asServiceRole.entities.QuizCompletion.filter({
                        externalId
                    });

                    if (existing.length > 0) {
                        totalQuizzesSkipped++;
                        continue;
                    }

                    // Calculate percentage
                    const score = attempt.score || 0;
                    const maxScore = attempt.maxScore || 100;
                    const percentage = attempt.percentageScore || (maxScore > 0 ? Math.round((score / maxScore) * 100) : 0);

                    // Create quiz completion record
                    await base44.asServiceRole.entities.QuizCompletion.create({
                        externalId,
                        studentId: String(student.id),
                        studentEmail: student.email,
                        studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                        quizId: String(attempt.quiz?.id || 'unknown'),
                        quizName: attempt.quiz?.name || 'Unknown Quiz',
                        courseId: String(attempt.course?.id || ''),
                        courseName: attempt.course?.name || '',
                        score,
                        maxScore,
                        percentage,
                        attemptNumber: attempt.attemptNumber || 1,
                        completedAt: attempt.completedAt || new Date().toISOString(),
                        timeSpentSeconds: attempt.timeSpent || 0
                    });

                    totalQuizzesAdded++;
                }

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error: any) {
                console.error(`[GRAPHQL BACKFILL] Error for ${student.email}:`, error.message);
                errors.push({
                    student: student.email,
                    error: error.message
                });
            }
        }

        console.log(`[GRAPHQL BACKFILL] Complete: ${totalQuizzesAdded} added, ${totalQuizzesSkipped} skipped`);

        return Response.json({
            success: true,
            studentsProcessed,
            quizzesAdded: totalQuizzesAdded,
            quizzesSkipped: totalQuizzesSkipped,
            errors: errors.length > 0 ? errors : undefined,
            message: `Backfilled ${totalQuizzesAdded} quiz attempts for ${studentsProcessed} students via GraphQL`
        });

    } catch (error: any) {
        console.error('[GRAPHQL BACKFILL] Fatal error:', error);
        return Response.json({ 
            error: error.message,
            details: 'Check function logs for more information'
        }, { status: 500 });
    }
});