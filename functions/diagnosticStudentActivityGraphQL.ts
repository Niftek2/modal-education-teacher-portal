import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const GRAPHQL_URL = "https://api.thinkific.com/stable/graphql";

async function graphQLQuery(query, variables = {}) {
    if (!API_ACCESS_TOKEN) {
        throw new Error('THINKIFIC_API_ACCESS_TOKEN not configured');
    }

    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const status = response.status;
    const text = await response.text();

    if (status >= 400) {
        console.error(`[ACTIVITY] HTTP ${status}:`, text.substring(0, 300));
        throw new Error(`GraphQL HTTP ${status}`);
    }

    let body;
    try {
        body = JSON.parse(text);
    } catch (e) {
        console.error(`[ACTIVITY] Failed to parse:`, text.substring(0, 300));
        throw new Error(`Invalid JSON response`);
    }

    if (body.errors) {
        console.error(`[ACTIVITY] GraphQL errors:`, JSON.stringify(body.errors));
        throw new Error(`GraphQL errors: ${body.errors[0]?.message}`);
    }

    return body.data;
}

async function restRequest(endpoint) {
    const url = `https://api.thinkific.com/api/public/v1/${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`REST ${response.status}`);
    }

    return await response.json();
}

async function findUserByEmail(email) {
    try {
        const resp = await restRequest(`users?query[email]=${encodeURIComponent(email)}`);
        return resp.items?.[0];
    } catch (err) {
        console.error(`[ACTIVITY] Error finding user by email:`, err.message);
        return null;
    }
}

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return Response.json({ error: 'POST required' }, { status: 405 });
        }

        const body = await req.json();
        const { thinkificUserId, studentEmail } = body;

        let userId = thinkificUserId;

        // If email provided, resolve to userId first
        if (!userId && studentEmail) {
            console.log(`[ACTIVITY] Resolving email: ${studentEmail}`);
            const user = await findUserByEmail(studentEmail);
            if (!user) {
                return Response.json({ error: `User not found: ${studentEmail}` }, { status: 404 });
            }
            userId = user.id;
            console.log(`[ACTIVITY] Resolved to userId: ${userId}`);
        }

        if (!userId) {
            return Response.json({ error: 'thinkificUserId or studentEmail required' }, { status: 400 });
        }

        console.log(`\n[ACTIVITY] ========== STUDENT ACTIVITY SAMPLE ==========`);
        console.log(`[ACTIVITY] User ID: ${userId}`);
        console.log(`[ACTIVITY] Time: ${new Date().toISOString()}\n`);

        // Fetch enrollments with pagination
        const enrollments = [];
        let hasMoreEnrollments = true;
        let enrollmentCursor = null;

        console.log(`[ACTIVITY] Fetching enrollments...`);
        while (hasMoreEnrollments) {
            const query = `
                query GetEnrollments($userId: ID!, $after: String) {
                    user(gid: $userId) {
                        gid
                        email
                        firstName
                        lastName
                        courses(first: 20, after: $after) {
                            edges {
                                node {
                                    gid
                                    enrolledAt
                                    completedAt
                                    percentageCompleted
                                    course {
                                        gid
                                        name
                                    }
                                }
                                cursor
                            }
                            pageInfo {
                                hasNextPage
                                endCursor
                            }
                        }
                    }
                }
            `;

            const variables = { userId: String(userId) };
            if (enrollmentCursor) variables.after = enrollmentCursor;

            const data = await graphQLQuery(query, variables);

            if (!data.user) {
                console.error(`[ACTIVITY] User not found in GraphQL`);
                return Response.json({ error: 'User not found' }, { status: 404 });
            }

            const edges = data.user.courses?.edges || [];
            enrollments.push(...edges.map(e => e.node));

            hasMoreEnrollments = data.user.courses?.pageInfo?.hasNextPage || false;
            enrollmentCursor = data.user.courses?.pageInfo?.endCursor;

            console.log(`[ACTIVITY] Fetched ${edges.length} enrollments (total: ${enrollments.length}, hasNext: ${hasMoreEnrollments})`);
        }

        console.log(`[ACTIVITY] Total enrollments: ${enrollments.length}\n`);

        // For each enrollment, fetch completed contents and quiz attempts
        const enrollmentDetails = [];
        const allCompletedSamples = [];
        const allQuizSamples = [];

        for (const enrollment of enrollments) {
            const enrollmentId = enrollment.gid;
            const courseId = enrollment.course.gid;
            const courseName = enrollment.course.name;

            console.log(`[ACTIVITY] Processing enrollment ${enrollmentId} (${courseName})...`);

            const detail = {
                enrollmentId,
                courseId,
                courseName,
                percentageCompleted: enrollment.percentageCompleted,
                completedContentsCount: 0,
                quizAttemptsCount: 0,
                completedContents: [],
                quizAttempts: []
            };

            // Fetch completed contents with pagination
            try {
                let hasMoreContents = true;
                let contentsCursor = null;

                while (hasMoreContents) {
                    const query = `
                        query GetCompletedContents($userId: ID!, $courseId: ID!, $after: String) {
                            userCourseEnrollment(userGid: $userId, courseGid: $courseId) {
                                gid
                                progress {
                                    completedContents(first: 20, after: $after) {
                                        edges {
                                            node {
                                                gid
                                                name
                                                type
                                                completedAt
                                            }
                                            cursor
                                        }
                                        pageInfo {
                                            hasNextPage
                                            endCursor
                                        }
                                    }
                                }
                            }
                        }
                    `;

                    const variables = {
                        userId: String(userId),
                        courseId: String(courseId)
                    };
                    if (contentsCursor) variables.after = contentsCursor;

                    const data = await graphQLQuery(query, variables);

                    const edges = data.userCourseEnrollment?.progress?.completedContents?.edges || [];
                    detail.completedContents.push(...edges.map(e => e.node));
                    detail.completedContentsCount += edges.length;

                    hasMoreContents = data.userCourseEnrollment?.progress?.completedContents?.pageInfo?.hasNextPage || false;
                    contentsCursor = data.userCourseEnrollment?.progress?.completedContents?.pageInfo?.endCursor;

                    console.log(`[ACTIVITY]   Completed contents: ${detail.completedContents.length} (hasNext: ${hasMoreContents})`);
                }

                // Collect first 5 samples
                detail.completedContents.slice(0, 5).forEach(item => {
                    allCompletedSamples.push({
                        contentId: item.gid,
                        contentTitle: item.name,
                        contentType: item.type,
                        completedAt: item.completedAt,
                        course: courseName
                    });
                });

            } catch (err) {
                console.error(`[ACTIVITY]   Error fetching completed contents:`, err.message);
            }

            // Fetch quiz attempts with pagination
            try {
                let hasMoreQuizzes = true;
                let quizCursor = null;

                while (hasMoreQuizzes) {
                    const query = `
                        query GetQuizAttempts($userId: ID!, $courseId: ID!, $after: String) {
                            userCourseEnrollment(userGid: $userId, courseGid: $courseId) {
                                gid
                                quizAttempts(first: 20, after: $after) {
                                    edges {
                                        node {
                                            gid
                                            score
                                            maxScore
                                            percentageScore
                                            attemptNumber
                                            submittedAt
                                            timeSpentSeconds
                                            quiz {
                                                gid
                                                name
                                            }
                                        }
                                        cursor
                                    }
                                    pageInfo {
                                        hasNextPage
                                        endCursor
                                    }
                                }
                            }
                        }
                    `;

                    const variables = {
                        userId: String(userId),
                        courseId: String(courseId)
                    };
                    if (quizCursor) variables.after = quizCursor;

                    const data = await graphQLQuery(query, variables);

                    const edges = data.userCourseEnrollment?.quizAttempts?.edges || [];
                    detail.quizAttempts.push(...edges.map(e => e.node));
                    detail.quizAttemptsCount += edges.length;

                    hasMoreQuizzes = data.userCourseEnrollment?.quizAttempts?.pageInfo?.hasNextPage || false;
                    quizCursor = data.userCourseEnrollment?.quizAttempts?.pageInfo?.endCursor;

                    console.log(`[ACTIVITY]   Quiz attempts: ${detail.quizAttempts.length} (hasNext: ${hasMoreQuizzes})`);
                }

                // Collect first 5 samples
                detail.quizAttempts.slice(0, 5).forEach(item => {
                    allQuizSamples.push({
                        quizId: item.quiz?.gid,
                        quizName: item.quiz?.name,
                        score: item.score,
                        maxScore: item.maxScore,
                        percentage: item.percentageScore,
                        attemptNumber: item.attemptNumber,
                        submittedAt: item.submittedAt,
                        course: courseName
                    });
                });

            } catch (err) {
                console.error(`[ACTIVITY]   Error fetching quiz attempts:`, err.message);
            }

            enrollmentDetails.push(detail);
        }

        console.log(`\n[ACTIVITY] ========== SUMMARY ==========\n`);

        return Response.json({
            userId,
            enrollmentsFound: enrollments.length,
            enrollmentDetails,
            completedContentsSamples: allCompletedSamples.slice(0, 5),
            quizAttemptsSamples: allQuizSamples.slice(0, 5),
            totalCompletedContents: enrollmentDetails.reduce((sum, e) => sum + e.completedContentsCount, 0),
            totalQuizAttempts: enrollmentDetails.reduce((sum, e) => sum + e.quizAttemptsCount, 0),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[ACTIVITY] Error:', error);
        return Response.json({
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});