import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import { graphQLQuery } from './lib/thinkificGraphQLClient.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function verifySession(token) {
    if (!token) throw new Error('Unauthorized');
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `graphql_backfill:${type}:${userId}:${courseId}:${contentId}:${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 64);
}

async function restRequest(endpoint) {
    const url = `https://api.thinkific.com/api/public/v1/${endpoint}`;
    console.log(`[SYNC] REST GET ${url}`);

    const response = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`[SYNC] REST ${response.status}:`, text.substring(0, 300));
        throw new Error(`REST ${response.status}`);
    }

    return await response.json();
}

async function getAllEnrollments(userId) {
    console.log(`[SYNC] Fetching enrollments for user ${userId}`);
    
    let allEnrollments = [];
    let page = 1;
    
    while (true) {
        const data = await restRequest(`enrollments?query[user_id]=${userId}&page=${page}`);
        const items = data.items || [];
        allEnrollments = [...allEnrollments, ...items];
        
        console.log(`[SYNC]   Page ${page}: ${items.length} enrollments (total: ${allEnrollments.length})`);
        
        if (!data.pagination?.next_page || items.length === 0) break;
        page++;
    }
    
    return allEnrollments;
}

Deno.serve(async (req) => {
    try {
        const { studentEmail, sessionToken } = await req.json();
        
        await verifySession(sessionToken);

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail required' }, { status: 400 });
        }

        console.log(`\n[SYNC] ========== START SYNC FOR ${studentEmail} ==========\n`);

        const base44 = createClientFromRequest(req);

        // Step 1: REST - Find user by email
        console.log(`[SYNC] Step 1: REST lookup user by email`);
        const userResp = await restRequest(`users?query[email]=${encodeURIComponent(studentEmail)}`);
        
        if (!userResp.items || userResp.items.length === 0) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        const user = userResp.items[0];
        const userId = user.id;
        const userName = `${user.first_name || ''} ${user.last_name || ''}`.trim();

        console.log(`[SYNC] Found: ID=${userId}, Name=${userName}`);

        // Step 2: REST - Get all enrollments
        console.log(`[SYNC] Step 2: REST fetch all enrollments`);
        const enrollments = await getAllEnrollments(userId);

        console.log(`[SYNC] Total enrollments: ${enrollments.length}`);

        let lessonsInserted = 0;
        let quizzesInserted = 0;
        const courseResults = [];
        const allErrors = [];

        // Step 3: GraphQL - For each enrollment, fetch lesson and quiz activity
        console.log(`[SYNC] Step 3: GraphQL fetch lesson/quiz activity per enrollment\n`);

        for (const enrollment of enrollments) {
            const enrollmentId = enrollment.id;
            const courseId = enrollment.course_id;
            const courseName = enrollment.course_name || `Course ${courseId}`;

            console.log(`[SYNC] Processing enrollment ${enrollmentId}: ${courseName} (courseId=${courseId})`);

            const courseResult = {
                enrollmentId,
                courseId,
                courseName,
                lessonsFound: 0,
                quizzesFound: 0,
                lessonsInserted: 0,
                quizzesInserted: 0,
                errors: []
            };

            // Query lessons
            try {
                console.log(`[SYNC]   [GraphQL] Querying lesson completions...`);
                
                const lessonQuery = `
                  query GetLessonCompletions($userId: Int!, $courseId: Int!) {
                    legacyLessonCompletions(userId: $userId, courseId: $courseId, first: 100) {
                      edges {
                        node {
                          id
                          userId
                          lessonId
                          completedAt
                          lesson {
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
                `;

                const lessonResult = await graphQLQuery(lessonQuery, {
                    userId,
                    courseId
                });

                const lessonEdges = lessonResult.data?.legacyLessonCompletions?.edges || [];
                console.log(`[SYNC]   [GraphQL] Lesson completions found: ${lessonEdges.length}`);

                courseResult.lessonsFound = lessonEdges.length;

                for (const edge of lessonEdges) {
                    const node = edge.node;
                    const lessonId = node.lessonId;
                    const lessonName = node.lesson?.name || `Lesson ${lessonId}`;
                    const completedAt = node.completedAt;

                    console.log(`[SYNC]     Lesson: ${lessonName} (${lessonId}) completed at ${completedAt}`);

                    const dedupeKey = await createDedupeKey('lesson_completed', userId, lessonId, courseId, completedAt);
                    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });

                    if (existing.length === 0) {
                        await base44.asServiceRole.entities.ActivityEvent.create({
                            studentUserId: String(userId),
                            studentEmail: studentEmail,
                            studentDisplayName: userName,
                            courseId: String(courseId),
                            courseName: courseName,
                            eventType: 'lesson_completed',
                            contentId: String(lessonId),
                            contentTitle: lessonName,
                            occurredAt: completedAt,
                            source: 'graphql_backfill',
                            rawEventId: '',
                            rawPayload: JSON.stringify(node),
                            dedupeKey,
                            metadata: {}
                        });
                        courseResult.lessonsInserted++;
                        lessonsInserted++;
                        console.log(`[SYNC]       ✓ Inserted`);
                    } else {
                        console.log(`[SYNC]       (duplicate, skipped)`);
                    }
                }

            } catch (error) {
                console.error(`[SYNC]   [GraphQL] Lesson query error:`, error.message);
                courseResult.errors.push(`Lesson query: ${error.message}`);
                allErrors.push(`${courseName} lessons: ${error.message}`);
            }

            // Query quizzes
            try {
                console.log(`[SYNC]   [GraphQL] Querying quiz attempts...`);

                const quizQuery = `
                  query GetQuizAttempts($userId: Int!, $courseId: Int!) {
                    legacyQuizAttempts(userId: $userId, courseId: $courseId, first: 100) {
                      edges {
                        node {
                          id
                          userId
                          quizId
                          score
                          maxScore
                          attemptedAt
                          quiz {
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
                `;

                const quizResult = await graphQLQuery(quizQuery, {
                    userId,
                    courseId
                });

                const quizEdges = quizResult.data?.legacyQuizAttempts?.edges || [];
                console.log(`[SYNC]   [GraphQL] Quiz attempts found: ${quizEdges.length}`);

                courseResult.quizzesFound = quizEdges.length;

                for (const edge of quizEdges) {
                    const node = edge.node;
                    const quizId = node.quizId;
                    const quizName = node.quiz?.name || `Quiz ${quizId}`;
                    const attemptedAt = node.attemptedAt;
                    const score = node.score;
                    const maxScore = node.maxScore;
                    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

                    console.log(`[SYNC]     Quiz: ${quizName} (${quizId}) attempted at ${attemptedAt}, score ${score}/${maxScore}`);

                    const dedupeKey = await createDedupeKey('quiz_attempted', userId, quizId, courseId, attemptedAt);
                    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });

                    if (existing.length === 0) {
                        await base44.asServiceRole.entities.ActivityEvent.create({
                            studentUserId: String(userId),
                            studentEmail: studentEmail,
                            studentDisplayName: userName,
                            courseId: String(courseId),
                            courseName: courseName,
                            eventType: 'quiz_attempted',
                            contentId: String(quizId),
                            contentTitle: quizName,
                            occurredAt: attemptedAt,
                            source: 'graphql_backfill',
                            rawEventId: '',
                            rawPayload: JSON.stringify(node),
                            dedupeKey,
                            metadata: {
                                score,
                                maxScore,
                                percentage
                            }
                        });
                        courseResult.quizzesInserted++;
                        quizzesInserted++;
                        console.log(`[SYNC]       ✓ Inserted (${percentage}%)`);
                    } else {
                        console.log(`[SYNC]       (duplicate, skipped)`);
                    }
                }

            } catch (error) {
                console.error(`[SYNC]   [GraphQL] Quiz query error:`, error.message);
                courseResult.errors.push(`Quiz query: ${error.message}`);
                allErrors.push(`${courseName} quizzes: ${error.message}`);
            }

            courseResults.push(courseResult);
            console.log(`[SYNC] Enrollment complete: ${courseResult.lessonsInserted} lessons, ${courseResult.quizzesInserted} quizzes\n`);
        }

        console.log(`[SYNC] ========== SYNC COMPLETE ==========`);
        console.log(`[SYNC] Total: ${lessonsInserted} lessons, ${quizzesInserted} quizzes inserted\n`);

        return Response.json({
            success: true,
            studentEmail,
            thinkificUserId: userId,
            userName,
            enrollmentsProcessed: enrollments.length,
            lessonsInserted,
            quizzesInserted,
            courseDetails: courseResults,
            errors: allErrors
        });

    } catch (error) {
        console.error('[SYNC] Fatal error:', error);
        return Response.json({ 
            error: error.message
        }, { status: 500 });
    }
});