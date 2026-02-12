// Thinkific GraphQL Client for historical data backfill
// Uses API Access Token Authorization (required for GraphQL)
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const GRAPHQL_URL = "https://api.thinkific.com/stable/graphql";

async function graphqlRequest(query, variables = {}) {
    const requestId = crypto.randomUUID();
    console.log(`[GraphQL ${requestId}] Executing query`);
    
    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`[GraphQL ${requestId}] Error ${response.status}:`, text);
        throw new Error(`GraphQL request failed: ${response.status} ${text}`);
    }

    const result = await response.json();
    
    if (result.errors) {
        console.error(`[GraphQL ${requestId}] GraphQL errors:`, result.errors);
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    console.log(`[GraphQL ${requestId}] Success`);
    return result.data;
}

export const ThinkificGraphQL = {
    // Get all enrollments for a user
    async getUserEnrollments(userId) {
        const query = `
            query GetUserEnrollments($userId: ID!) {
                user(id: $userId) {
                    id
                    email
                    firstName
                    lastName
                    enrollments {
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
                        }
                    }
                }
            }
        `;

        const data = await graphqlRequest(query, { userId: String(userId) });
        return data.user?.enrollments?.edges?.map(edge => edge.node) || [];
    },

    // Get course contents with completion status for a user
    async getCourseContentsWithProgress(userId, courseId) {
        const query = `
            query GetCourseProgress($userId: ID!, $courseId: ID!) {
                user(id: $userId) {
                    id
                    enrollment(courseId: $courseId) {
                        id
                        course {
                            id
                            name
                            chapters {
                                edges {
                                    node {
                                        id
                                        name
                                        contents {
                                            edges {
                                                node {
                                                    id
                                                    name
                                                    contentType
                                                    ... on Lesson {
                                                        id
                                                        name
                                                    }
                                                    ... on Quiz {
                                                        id
                                                        name
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        completedContents {
                            edges {
                                node {
                                    id
                                    name
                                    contentType
                                    completedAt
                                }
                            }
                        }
                    }
                }
            }
        `;

        const data = await graphqlRequest(query, { 
            userId: String(userId), 
            courseId: String(courseId) 
        });

        return {
            courseName: data.user?.enrollment?.course?.name || 'Unknown Course',
            completedContents: data.user?.enrollment?.completedContents?.edges?.map(edge => edge.node) || []
        };
    },

    // Get quiz attempts for a user in a course
    async getQuizAttempts(userId, courseId) {
        const query = `
            query GetQuizAttempts($userId: ID!, $courseId: ID!) {
                user(id: $userId) {
                    id
                    enrollment(courseId: $courseId) {
                        id
                        course {
                            name
                        }
                        quizAttempts {
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
                            }
                        }
                    }
                }
            }
        `;

        try {
            const data = await graphqlRequest(query, { 
                userId: String(userId), 
                courseId: String(courseId) 
            });

            const courseName = data.user?.enrollment?.course?.name || 'Unknown Course';
            const attempts = data.user?.enrollment?.quizAttempts?.edges?.map(edge => ({
                ...edge.node,
                courseName
            })) || [];

            return attempts;
        } catch (error) {
            console.log(`No quiz attempts found for user ${userId} in course ${courseId}:`, error.message);
            return [];
        }
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