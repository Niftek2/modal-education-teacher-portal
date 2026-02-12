// Thinkific GraphQL Client for historical data backfill
// Uses API Access Token Authorization (required for GraphQL)
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const GRAPHQL_URL = "https://api.thinkific.com/stable/graphql";

async function graphqlRequest(query, variables = {}) {
    const requestId = crypto.randomUUID();
    console.log(`[GraphQL ${requestId}] Query:`, query.substring(0, 200));
    console.log(`[GraphQL ${requestId}] Variables:`, JSON.stringify(variables));
    
    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const text = await response.text();
    console.log(`[GraphQL ${requestId}] Status: ${response.status}`);
    console.log(`[GraphQL ${requestId}] Response body (first 500 chars):`, text.substring(0, 500));

    if (!response.ok) {
        console.error(`[GraphQL ${requestId}] Full error response:`, text);
        throw new Error(`GraphQL request failed: ${response.status} - ${text.substring(0, 200)}`);
    }

    const result = JSON.parse(text);
    
    if (result.errors) {
        console.error(`[GraphQL ${requestId}] GraphQL errors:`, JSON.stringify(result.errors, null, 2));
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    console.log(`[GraphQL ${requestId}] Success - data keys:`, Object.keys(result.data || {}));
    return result.data;
}

export const ThinkificGraphQL = {
    // Get all enrollments for a user with pagination
    async getUserEnrollments(userId) {
        const allEnrollments = [];
        let hasNextPage = true;
        let endCursor = null;

        while (hasNextPage) {
            const query = `
                query GetUserEnrollments($userId: ID!, $after: String) {
                    user(id: $userId) {
                        id
                        email
                        firstName
                        lastName
                        enrollments(first: 50, after: $after) {
                            edges {
                                node {
                                    id
                                    activatedAt
                                    completedAt
                                    expiresAt
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
            if (endCursor) {
                variables.after = endCursor;
            }

            const data = await graphqlRequest(query, variables);
            
            if (!data.user) {
                console.log(`[GraphQL] User ${userId} not found`);
                break;
            }

            const enrollments = data.user.enrollments?.edges?.map(edge => edge.node) || [];
            allEnrollments.push(...enrollments);

            hasNextPage = data.user.enrollments?.pageInfo?.hasNextPage || false;
            endCursor = data.user.enrollments?.pageInfo?.endCursor;

            console.log(`[GraphQL] Fetched ${enrollments.length} enrollments (total: ${allEnrollments.length}, hasNext: ${hasNextPage})`);
        }

        return allEnrollments;
    },

    // Get completed contents for a user's enrollment with pagination
    async getCompletedContents(userId, courseId) {
        const allCompleted = [];
        let hasNextPage = true;
        let endCursor = null;

        while (hasNextPage) {
            const query = `
                query GetCompletedContents($userId: ID!, $courseId: ID!, $after: String) {
                    enrollment(userId: $userId, courseId: $courseId) {
                        id
                        course {
                            id
                            name
                        }
                        progress {
                            completedContents(first: 100, after: $after) {
                                edges {
                                    node {
                                        id
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
            if (endCursor) {
                variables.after = endCursor;
            }

            try {
                const data = await graphqlRequest(query, variables);
                
                if (!data.enrollment) {
                    console.log(`[GraphQL] No enrollment found for user ${userId} in course ${courseId}`);
                    break;
                }

                const courseName = data.enrollment.course?.name || 'Unknown Course';
                const contents = data.enrollment.progress?.completedContents?.edges?.map(edge => ({
                    ...edge.node,
                    courseName
                })) || [];

                allCompleted.push(...contents);

                hasNextPage = data.enrollment.progress?.completedContents?.pageInfo?.hasNextPage || false;
                endCursor = data.enrollment.progress?.completedContents?.pageInfo?.endCursor;

                console.log(`[GraphQL] Fetched ${contents.length} completed contents (total: ${allCompleted.length}, hasNext: ${hasNextPage})`);
            } catch (error) {
                console.error(`[GraphQL] Error fetching completed contents:`, error.message);
                break;
            }
        }

        return allCompleted;
    },

    // Get quiz attempts for a user in a course with pagination
    async getQuizAttempts(userId, courseId) {
        const allAttempts = [];
        let hasNextPage = true;
        let endCursor = null;

        while (hasNextPage) {
            const query = `
                query GetQuizAttempts($userId: ID!, $courseId: ID!, $after: String) {
                    enrollment(userId: $userId, courseId: $courseId) {
                        id
                        course {
                            id
                            name
                        }
                        quizAttempts(first: 100, after: $after) {
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
            `;

            const variables = { 
                userId: String(userId), 
                courseId: String(courseId)
            };
            if (endCursor) {
                variables.after = endCursor;
            }

            try {
                const data = await graphqlRequest(query, variables);
                
                if (!data.enrollment) {
                    console.log(`[GraphQL] No enrollment found for user ${userId} in course ${courseId}`);
                    break;
                }

                const courseName = data.enrollment.course?.name || 'Unknown Course';
                const attempts = data.enrollment.quizAttempts?.edges?.map(edge => ({
                    ...edge.node,
                    courseName
                })) || [];

                allAttempts.push(...attempts);

                hasNextPage = data.enrollment.quizAttempts?.pageInfo?.hasNextPage || false;
                endCursor = data.enrollment.quizAttempts?.pageInfo?.endCursor;

                console.log(`[GraphQL] Fetched ${attempts.length} quiz attempts (total: ${allAttempts.length}, hasNext: ${hasNextPage})`);
            } catch (error) {
                console.error(`[GraphQL] Error fetching quiz attempts:`, error.message);
                break;
            }
        }

        return allAttempts;
    },

    // Test GraphQL connection
    async testConnection() {
        const query = `
            query TestConnection {
                users(first: 1) {
                    edges {
                        node {
                            id
                            email
                            firstName
                            lastName
                        }
                    }
                }
            }
        `;

        try {
            const data = await graphqlRequest(query);
            console.log('[GraphQL] Connection test successful');
            return { success: true, data };
        } catch (error) {
            console.error('[GraphQL] Connection test failed:', error);
            return { success: false, error: error.message };
        }
    }
};