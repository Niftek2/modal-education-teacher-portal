const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

async function restRequest(endpoint) {
    const url = `https://api.thinkific.com/api/public/v1/${endpoint}`;
    console.log(`[DIAG] REST GET ${url}`);

    const response = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`[DIAG] REST ${response.status}`);
        throw new Error(`REST ${response.status}`);
    }

    return await response.json();
}

async function graphQLQuery(query, variables = {}) {
    if (!API_ACCESS_TOKEN) {
        throw new Error('THINKIFIC_API_ACCESS_TOKEN not configured');
    }

    const url = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/graphql`;
    
    console.log(`[DIAG] GraphQL POST ${url}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        },
        body: JSON.stringify({
            query,
            variables
        })
    });

    const status = response.status;
    const body = await response.json();

    console.log(`[DIAG] GraphQL response status: ${status}`);

    if (body.errors) {
        console.error(`[DIAG] GraphQL errors:`, JSON.stringify(body.errors, null, 2));
    }

    return { status, data: body.data, errors: body.errors };
}

Deno.serve(async (req) => {
    try {
        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail required' }, { status: 400 });
        }

        console.log(`\n[DIAG] ========== LESSON COMPLETION DIAGNOSTIC ==========\n`);

        // Step 1: Find user
        console.log(`[DIAG] Step 1: Find user by email`);
        const userResp = await restRequest(`users?query[email]=${encodeURIComponent(studentEmail)}`);
        
        if (!userResp.items || userResp.items.length === 0) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const user = userResp.items[0];
        const userId = user.id;
        console.log(`[DIAG] Found userId: ${userId}\n`);

        // Step 2: Get enrollments and explore what REST endpoints exist
        console.log(`[DIAG] Step 2: REST enrollments endpoint`);
        const enrollResp = await restRequest(`enrollments?query[user_id]=${userId}`);
        const enrollments = enrollResp.items || [];
        console.log(`[DIAG] Enrollments found: ${enrollments.length}`);

        const restResults = {
            enrollmentsCount: enrollments.length,
            sampleEnrollment: null,
            lessonCompletionsViaRest: null,
            chaptersViaRest: null,
            courseProgressViaRest: null,
            restEndpointsChecked: []
        };

        // Pick first enrollment to test
        if (enrollments.length > 0) {
            const firstEnroll = enrollments[0];
            restResults.sampleEnrollment = {
                id: firstEnroll.id,
                courseId: firstEnroll.course_id,
                courseName: firstEnroll.course_name,
                enrolledAt: firstEnroll.enrolled_at
            };

            const courseId = firstEnroll.course_id;

            // Try: courses/{courseId}/lesson_completions
            console.log(`[DIAG] Testing: GET /courses/${courseId}/lesson_completions?query[user_id]=${userId}`);
            try {
                const resp = await restRequest(`courses/${courseId}/lesson_completions?query[user_id]=${userId}`);
                console.log(`[DIAG]   ✓ Status 200. Items: ${resp.items?.length || 0}`);
                if (resp.items && resp.items.length > 0) {
                    console.log(`[DIAG]   Sample item:`, JSON.stringify(resp.items[0], null, 2));
                    restResults.lessonCompletionsViaRest = {
                        endpoint: `courses/${courseId}/lesson_completions`,
                        statusCode: 200,
                        count: resp.items.length,
                        hasTiming: resp.items[0]?.completed_at ? 'YES' : 'NO',
                        sampleItem: resp.items[0]
                    };
                } else {
                    restResults.lessonCompletionsViaRest = {
                        endpoint: `courses/${courseId}/lesson_completions`,
                        statusCode: 200,
                        count: 0,
                        hasTiming: 'N/A (no items)'
                    };
                }
                restResults.restEndpointsChecked.push('courses/{courseId}/lesson_completions');
            } catch (err) {
                console.log(`[DIAG]   ✗ Error: ${err.message}`);
                restResults.restEndpointsChecked.push('courses/{courseId}/lesson_completions (error)');
            }

            // Try: users/{userId}/lesson_completions
            console.log(`[DIAG] Testing: GET /users/${userId}/lesson_completions`);
            try {
                const resp = await restRequest(`users/${userId}/lesson_completions`);
                console.log(`[DIAG]   ✓ Status 200. Items: ${resp.items?.length || 0}`);
                if (resp.items && resp.items.length > 0) {
                    console.log(`[DIAG]   Sample item:`, JSON.stringify(resp.items[0], null, 2));
                }
                restResults.restEndpointsChecked.push('users/{userId}/lesson_completions (200)');
            } catch (err) {
                console.log(`[DIAG]   ✗ Error: ${err.message}`);
                restResults.restEndpointsChecked.push('users/{userId}/lesson_completions (error)');
            }

            // Try: chapters (with user_id filter)
            console.log(`[DIAG] Testing: GET /chapters?query[course_id]=${courseId}`);
            try {
                const resp = await restRequest(`chapters?query[course_id]=${courseId}`);
                console.log(`[DIAG]   ✓ Status 200. Items: ${resp.items?.length || 0}`);
                if (resp.items && resp.items.length > 0) {
                    console.log(`[DIAG]   Sample chapter:`, JSON.stringify(resp.items[0], null, 2).substring(0, 300));
                    restResults.chaptersViaRest = {
                        endpoint: `chapters?query[course_id]=${courseId}`,
                        statusCode: 200,
                        count: resp.items.length,
                        hasCompletionData: resp.items[0]?.completed ? 'YES' : 'NO'
                    };
                }
                restResults.restEndpointsChecked.push('chapters (200)');
            } catch (err) {
                console.log(`[DIAG]   ✗ Error: ${err.message}`);
                restResults.restEndpointsChecked.push('chapters (error)');
            }
        }

        // Step 3: Test GraphQL schema for lesson completions with timestamps
        console.log(`\n[DIAG] Step 3: GraphQL schema exploration\n`);

        const graphqlResults = {
            tokenConfigured: !!API_ACCESS_TOKEN,
            legacyLessonCompletionsAvailable: false,
            legacyLessonCompletionsSchema: null,
            hasCompletedAtField: false,
            error: null
        };

        if (!API_ACCESS_TOKEN) {
            console.log(`[DIAG] GraphQL: THINKIFIC_API_ACCESS_TOKEN not configured. Skipping GraphQL tests.`);
            graphqlResults.error = 'THINKIFIC_API_ACCESS_TOKEN not configured';
        } else {
            try {
                // First, try the introspection query to see if legacyLessonCompletions exists
                const introspectionQuery = `
                  query {
                    __type(name: "Query") {
                      fields {
                        name
                      }
                    }
                  }
                `;

                console.log(`[DIAG] Testing GraphQL: Introspection query for Query fields`);
                const introspectResult = await graphQLQuery(introspectionQuery, {});
                
                const fields = introspectResult.data?.__type?.fields || [];
                const fieldNames = fields.map(f => f.name);
                console.log(`[DIAG] Available Query fields (first 20):`, fieldNames.slice(0, 20).join(', ') + (fieldNames.length > 20 ? '...' : ''));

                const hasLessonCompletions = fieldNames.includes('legacyLessonCompletions');
                console.log(`[DIAG] legacyLessonCompletions available: ${hasLessonCompletions ? 'YES' : 'NO'}`);

                graphqlResults.legacyLessonCompletionsAvailable = hasLessonCompletions;

                if (hasLessonCompletions) {
                    // Now try to actually query it
                    console.log(`[DIAG] Testing GraphQL: legacyLessonCompletions query with sample data\n`);

                    const lessonQuery = `
                      query GetLessonCompletions($userId: Int!, $courseId: Int!) {
                        legacyLessonCompletions(userId: $userId, courseId: $courseId, first: 1) {
                          edges {
                            node {
                              id
                              userId
                              lessonId
                              completedAt
                              createdAt
                              updatedAt
                              lesson {
                                id
                                name
                              }
                            }
                          }
                        }
                      }
                    `;

                    const firstEnroll = enrollments[0];
                    const lessonResult = await graphQLQuery(lessonQuery, {
                        userId,
                        courseId: firstEnroll.course_id
                    });

                    if (lessonResult.errors) {
                        console.log(`[DIAG] GraphQL errors:`, JSON.stringify(lessonResult.errors, null, 2));
                        graphqlResults.error = lessonResult.errors[0]?.message;
                    } else {
                        const edges = lessonResult.data?.legacyLessonCompletions?.edges || [];
                        console.log(`[DIAG] legacyLessonCompletions query returned ${edges.length} items`);

                        if (edges.length > 0) {
                            const sample = edges[0].node;
                            console.log(`[DIAG] Sample node:`, JSON.stringify(sample, null, 2));
                            
                            graphqlResults.hasCompletedAtField = sample.completedAt ? true : false;
                            graphqlResults.legacyLessonCompletionsSchema = {
                                fieldsReturned: Object.keys(sample),
                                hasCompletedAt: sample.completedAt ? true : false,
                                completedAtValue: sample.completedAt,
                                hasCreatedAt: sample.createdAt ? true : false,
                                hasUpdatedAt: sample.updatedAt ? true : false
                            };
                        } else {
                            console.log(`[DIAG] No lesson completions returned (student may not have any)`);
                            graphqlResults.legacyLessonCompletionsSchema = {
                                note: 'Query executed but no data returned (student may not have lesson completions)',
                                fieldsAvailable: ['id', 'userId', 'lessonId', 'completedAt', 'createdAt', 'updatedAt', 'lesson']
                            };
                        }
                    }
                }

            } catch (error) {
                console.error(`[DIAG] GraphQL error:`, error.message);
                graphqlResults.error = error.message;
            }
        }

        console.log(`\n[DIAG] ========== SUMMARY ==========\n`);

        return Response.json({
            studentEmail,
            userId,
            restEndpointResults: restResults,
            graphqlResults: graphqlResults,
            recommendation: {
                restHasLessonCompletions: restResults.lessonCompletionsViaRest?.count > 0 ? true : false,
                restHasTimestamps: restResults.lessonCompletionsViaRest?.hasTiming === 'YES',
                graphqlHasLessonCompletions: graphqlResults.legacyLessonCompletionsAvailable,
                graphqlHasTimestamps: graphqlResults.hasCompletedAtField,
                nextStep: !graphqlResults.tokenConfigured
                    ? 'Need to set THINKIFIC_API_ACCESS_TOKEN to test GraphQL'
                    : graphqlResults.legacyLessonCompletionsAvailable && graphqlResults.hasCompletedAtField 
                    ? 'REST insufficient, proceed with GraphQL (token configured)'
                    : restResults.lessonCompletionsViaRest?.hasTiming === 'YES'
                    ? 'REST endpoint exists with timestamps, no GraphQL needed'
                    : 'No lesson completion timestamps available in either REST or GraphQL'
            }
        });

    } catch (error) {
        console.error('[DIAG] Fatal error:', error);
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});