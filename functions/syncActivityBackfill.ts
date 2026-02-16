import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';
import { ThinkificGraphQL } from './lib/thinkificGraphQL.js';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function makeRequest(endpoint) {
    const url = `https://api.thinkific.com/api/public/v1/${endpoint}`;
    console.log(`[SYNC] Fetching: ${url}`);
    
    const response = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    console.log(`[SYNC] Response status: ${response.status}`);
    
    if (!response.ok) {
        const text = await response.text();
        console.error(`[SYNC] API error ${response.status}: ${text.substring(0, 300)}`);
        throw new Error(`API error ${response.status}`);
    }
    
    return await response.json();
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { groupId } = await req.json();

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log(`[SYNC] Starting activity backfill for group ${groupId}`);
        const base44 = createClientFromRequest(req);

        // Get group members
        const groupData = await makeRequest(`groups/${groupId}`);
        const groupMembers = groupData.users || [];
        
        // Filter students (@modalmath.com emails)
        const students = groupMembers.filter(u => u.email?.endsWith('@modalmath.com'));
        console.log(`[SYNC] Found ${students.length} students in group`);

        let totalEventsImported = 0;
        const results = [];

        for (const student of students) {
            console.log(`[SYNC] Processing student: ${student.email}`);
            
            try {
                // Get all enrollments
                const enrollmentsData = await makeRequest(`enrollments?query[user_id]=${student.id}`);
                const enrollments = enrollmentsData.items || [];
                
                console.log(`[SYNC]   Found ${enrollments.length} enrollments`);
                
                let studentEventsImported = 0;

                // Fetch all completed contents via GraphQL with pagination
                console.log(`[SYNC]   Fetching lesson completions via GraphQL...`);
                try {
                    const completedContents = await ThinkificGraphQL.getCompletedContents(student.id, null);
                    console.log(`[SYNC]     Fetched ${completedContents.length} completed lessons/contents`);
                    
                    for (const content of completedContents) {
                        if (content.type === 'lesson' && content.completedAt) {
                            const dedupeKey = await createDedupeKey(
                                'lesson',
                                student.id,
                                content.id,
                                content.courseName,
                                content.completedAt
                            );
                            
                            const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                            if (existing.length === 0) {
                                await base44.asServiceRole.entities.ActivityEvent.create({
                                    studentUserId: String(student.id),
                                    studentEmail: student.email,
                                    studentDisplayName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                                    courseId: '',
                                    courseName: content.courseName || '',
                                    eventType: 'lesson_completed',
                                    contentId: String(content.id),
                                    contentTitle: content.name || 'Unknown Lesson',
                                    occurredAt: content.completedAt,
                                    source: 'rest_backfill',
                                    rawEventId: '',
                                    rawPayload: JSON.stringify(content),
                                    dedupeKey,
                                    metadata: {}
                                });
                                studentEventsImported++;
                                console.log(`[SYNC]       ✓ Lesson: ${content.name}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[SYNC]     Error fetching GraphQL lesson completions:`, error.message);
                }

                // Fetch quiz attempts via GraphQL
                console.log(`[SYNC]   Fetching quiz attempts via GraphQL...`);
                try {
                    const quizAttempts = await ThinkificGraphQL.getQuizAttempts(student.id, null);
                    console.log(`[SYNC]     Fetched ${quizAttempts.length} quiz attempts`);
                    
                    for (const attempt of quizAttempts) {
                        if (attempt.submittedAt) {
                            const dedupeKey = await createDedupeKey(
                                'quiz',
                                student.id,
                                attempt.quiz?.id,
                                attempt.courseName,
                                attempt.submittedAt
                            );
                            
                            const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                            if (existing.length === 0) {
                                await base44.asServiceRole.entities.ActivityEvent.create({
                                    studentUserId: String(student.id),
                                    studentEmail: student.email,
                                    studentDisplayName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                                    courseId: '',
                                    courseName: attempt.courseName || '',
                                    eventType: 'quiz_attempted',
                                    contentId: String(attempt.quiz?.id || ''),
                                    contentTitle: attempt.quiz?.name || 'Unknown Quiz',
                                    occurredAt: attempt.submittedAt,
                                    source: 'rest_backfill',
                                    rawEventId: '',
                                    rawPayload: JSON.stringify(attempt),
                                    dedupeKey,
                                    metadata: {
                                        score: attempt.score,
                                        maxScore: attempt.maxScore,
                                        percentage: attempt.percentageScore,
                                        attemptNumber: attempt.attemptNumber || 1,
                                        timeSpentSeconds: attempt.timeSpentSeconds || 0
                                    }
                                });
                                studentEventsImported++;
                                console.log(`[SYNC]       ✓ Quiz: ${attempt.quiz?.name} (${attempt.percentageScore}%)`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[SYNC]     Error fetching GraphQL quiz attempts:`, error.message);
                }

                for (const enrollment of enrollments) {
                    const courseId = enrollment.course_id;
                    const courseName = enrollment.course_name || `Course ${courseId}`;

                    // Try to get progress data (REST fallback)
                    try {
                        const progressData = await makeRequest(
                            `course_progresses?query[user_id]=${student.id}&query[course_id]=${courseId}`
                        );
                        const progress = progressData.items?.[0];
                        
                        if (progress) {
                            console.log(`[SYNC]     Course ${courseName}: progress data available`);
                            console.log(`[SYNC]       completed_chapters: ${progress.completed_chapter_ids?.length || 0}`);
                            console.log(`[SYNC]       percentage: ${progress.percentage_completed || 0}%`);
                        }
                    } catch (error) {
                        console.error(`[SYNC]     Error fetching progress for ${courseName}:`, error.message);
                    }
                }

                totalEventsImported += studentEventsImported;
                results.push({
                    email: student.email,
                    enrollments: enrollments.length,
                    eventsImported: studentEventsImported
                });

            } catch (error) {
                console.error(`[SYNC]   Error processing student ${student.email}:`, error.message);
                results.push({
                    email: student.email,
                    error: error.message
                });
            }
        }

        console.log(`[SYNC] Backfill complete. Total events imported: ${totalEventsImported}`);

        return Response.json({
            success: true,
            message: `Backfill complete. Imported ${totalEventsImported} events for ${students.length} students.`,
            studentsProcessed: students.length,
            eventsImported: totalEventsImported,
            details: results
        });

    } catch (error) {
        console.error('[SYNC] Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});