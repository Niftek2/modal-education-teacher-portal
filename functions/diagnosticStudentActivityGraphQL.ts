const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function graphQLQuery(query, variables = {}) {
    const response = await fetch("https://api.thinkific.com/stable/graphql", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        console.error('[ACTIVITY] Failed to parse response:', text.substring(0, 500));
        throw new Error('Invalid JSON response from GraphQL');
    }
    
    if (data.errors) {
        console.error('[ACTIVITY] GraphQL Error:', JSON.stringify(data.errors, null, 2));
        throw new Error(`GraphQL Error: ${data.errors[0]?.message || 'Unknown error'}`);
    }
    
    if (!response.ok) {
        throw new Error(`GraphQL HTTP ${response.status}`);
    }
    
    return data.data;
}

async function findUserByEmail(email) {
    const response = await fetch(`https://${THINKIFIC_SUBDOMAIN}.thinkific.com/api/v1/users?email=${encodeURIComponent(email)}`, {
        headers: {
            'X-API-KEY': Deno.env.get("THINKIFIC_API_KEY"),
            'Accept': 'application/json'
        }
    });
    
    const data = await response.json();
    const users = data.users || [];
    return users.length > 0 ? users[0].id : null;
}

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { thinkificUserId, studentEmail } = body;
        
        console.log('[ACTIVITY] ========== STUDENT ACTIVITY SAMPLE ==========');
        console.log('[ACTIVITY] Time:', new Date().toISOString());
        console.log('[ACTIVITY] User ID:', thinkificUserId, 'Email:', studentEmail);
        
        // Resolve user ID
        let userId = thinkificUserId;
        if (!userId && studentEmail) {
            console.log('[ACTIVITY] Looking up user by email...');
            userId = await findUserByEmail(studentEmail);
            if (!userId) {
                return Response.json({ error: 'User not found' }, { status: 404 });
            }
        }
        
        if (!userId) {
            return Response.json({ error: 'No user ID or email provided' }, { status: 400 });
        }
        
        console.log('[ACTIVITY] Resolved user ID:', userId);
        
        // ===== FETCH ENROLLMENTS =====
        console.log('[ACTIVITY] Fetching enrollments...');
        const enrollments = [];
        let enrollmentCursor = null;
        let hasMoreEnrollments = true;
        
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
                                    id
                                    enrolledAt
                                    completedAt
                                    percentageCompleted
                                    course {
                                        id
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
                console.error('[ACTIVITY] User not found in GraphQL');
                return Response.json({ error: 'User not found' }, { status: 404 });
            }

            const edges = data.user.courses?.edges || [];
            console.log(`[ACTIVITY] Found ${edges.length} course edges`);
            enrollments.push(...edges.map(e => e.node));

            hasMoreEnrollments = data.user.courses?.pageInfo?.hasNextPage || false;
            enrollmentCursor = data.user.courses?.pageInfo?.endCursor;
        }

        console.log(`[ACTIVITY] Total enrollments: ${enrollments.length}`);
        
        // ===== FETCH ACTIVITY PER ENROLLMENT =====
        const allCompletedSamples = [];
        const allQuizSamples = [];
        const enrollmentDetails = [];

        for (const enrollment of enrollments) {
            const enrollmentId = enrollment.id;
            const courseId = enrollment.course.id;
            const courseName = enrollment.course.name;
            
            console.log(`[ACTIVITY] Processing enrollment: ${courseName} (${courseId})`);
            
            const detail = {
                courseId,
                courseName,
                enrolledAt: enrollment.enrolledAt,
                completedAt: enrollment.completedAt,
                percentageCompleted: enrollment.percentageCompleted,
                completedContentsCount: 0,
                completedContents: [],
                quizAttemptsCount: 0,
                quizAttempts: []
            };

            // ===== FETCH COMPLETED CONTENTS =====
            console.log(`[ACTIVITY] Fetching completed contents for ${courseName}...`);
            let hasMoreContents = true;
            let contentsCursor = null;

            while (hasMoreContents) {
                const query = `
                    query GetCompletedContents($userId: ID!, $courseId: ID!, $after: String) {
                        user(gid: $userId) {
                            gid
                            courses(first: 50) {
                                edges {
                                    node {
                                        id
                                        progress {
                                            completedContents(first: 20, after: $after) {
                                                edges {
                                                    node {
                                                        id
                                                        name
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
                            }
                        }
                    }
                `;

                const variables = {
                    userId: String(userId),
                    courseId: String(courseId)
                };
                if (contentsCursor) variables.after = contentsCursor;

                try {
                    const data = await graphQLQuery(query, variables);
                    const courseEdges = data.user?.courses?.edges || [];
                    const matchedCourse = courseEdges.find(e => e.node.id === courseId);
                    const courseNode = matchedCourse?.node;
                    const edges = courseNode?.progress?.completedContents?.edges || [];
                    
                    console.log(`[ACTIVITY] Found ${edges.length} completed content items`);
                    detail.completedContents.push(...edges.map(e => e.node));
                    detail.completedContentsCount += edges.length;

                    hasMoreContents = courseNode?.progress?.completedContents?.pageInfo?.hasNextPage || false;
                    contentsCursor = courseNode?.progress?.completedContents?.pageInfo?.endCursor;
                } catch (error) {
                    console.log(`[ACTIVITY] Could not fetch completed contents (may not be available):`, error.message);
                    hasMoreContents = false;
                }
            }

            // Collect first 5 samples
            detail.completedContents.slice(0, 5).forEach(item => {
                allCompletedSamples.push({
                    contentId: item.id,
                    contentTitle: item.name,
                    completedAt: item.completedAt,
                    course: courseName
                });
            });

            // ===== FETCH QUIZ ATTEMPTS =====
            console.log(`[ACTIVITY] Fetching quiz attempts for ${courseName}...`);
            let hasMoreQuizzes = true;
            let quizCursor = null;

            while (hasMoreQuizzes) {
                const query = `
                    query GetQuizAttempts($userId: ID!, $courseId: ID!, $after: String) {
                        user(gid: $userId) {
                            gid
                            courses(first: 50) {
                                edges {
                                    node {
                                        id
                                        quizAttempts(first: 20, after: $after) {
                                            edges {
                                                node {
                                                    id
                                                    score
                                                    maxScore
                                                    percentageScore
                                                    attemptNumber
                                                    submittedAt
                                                    timeSpentSeconds
                                                    quiz {
                                                        id
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
                            }
                        }
                    }
                `;

                const variables = {
                    userId: String(userId),
                    courseId: String(courseId)
                };
                if (quizCursor) variables.after = quizCursor;

                try {
                    const data = await graphQLQuery(query, variables);
                    const courseEdges = data.user?.courses?.edges || [];
                    const matchedCourse = courseEdges.find(e => e.node.id === courseId);
                    const courseNode = matchedCourse?.node;
                    const edges = courseNode?.quizAttempts?.edges || [];
                    
                    console.log(`[ACTIVITY] Found ${edges.length} quiz attempts`);
                    detail.quizAttempts.push(...edges.map(e => e.node));
                    detail.quizAttemptsCount += edges.length;

                    hasMoreQuizzes = courseNode?.quizAttempts?.pageInfo?.hasNextPage || false;
                    quizCursor = courseNode?.quizAttempts?.pageInfo?.endCursor;
                } catch (error) {
                    console.log(`[ACTIVITY] Could not fetch quiz attempts:`, error.message);
                    hasMoreQuizzes = false;
                }
            }

            // Collect first 5 samples
            detail.quizAttempts.slice(0, 5).forEach(item => {
                allQuizSamples.push({
                    quizAttemptId: item.id,
                    quizId: item.quiz?.id,
                    quizName: item.quiz?.name,
                    score: item.score,
                    maxScore: item.maxScore,
                    percentage: item.percentageScore,
                    attemptNumber: item.attemptNumber,
                    submittedAt: item.submittedAt,
                    course: courseName
                });
            });

            enrollmentDetails.push(detail);
        }

        console.log('[ACTIVITY] ========== SAMPLE COMPLETE ==========');
        
        return Response.json({
            userId,
            enrollmentsFound: enrollments.length,
            enrollmentDetails,
            completedContentsSamples: allCompletedSamples,
            quizAttemptsSamples: allQuizSamples
        }, { status: 200 });

    } catch (error) {
        console.error('[ACTIVITY] Error:', error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});