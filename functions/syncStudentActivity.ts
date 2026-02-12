import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import { ThinkificClient } from './lib/thinkificClient.js';
import { ThinkificGraphQL } from './lib/thinkificGraphQL.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function createExternalId(...parts) {
    const data = parts.join('-');
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId, sessionToken } = await req.json();
        
        await verifySession(sessionToken);

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log(`[SYNC] Starting activity sync for group ${groupId}`);

        // Get all students in the group
        const groupUsers = await ThinkificClient.getGroupUsers(groupId);
        const students = groupUsers.filter(u => u.email?.includes('@modalmath.com'));

        console.log(`[SYNC] Found ${students.length} students to sync`);

        let totalLessons = 0;
        let totalQuizzes = 0;
        let studentsProcessed = 0;

        for (const student of students) {
            try {
                console.log(`[SYNC] Processing student: ${student.email} (ID: ${student.id})`);

                // Get all enrollments for this student using GraphQL
                const enrollments = await ThinkificGraphQL.getUserEnrollments(student.id);
                console.log(`[SYNC] Found ${enrollments.length} enrollments for ${student.email}`);

                let studentLatestActivity = null;

                for (const enrollment of enrollments) {
                    const courseId = enrollment.course.id;
                    const courseName = enrollment.course.name;

                    console.log(`[SYNC] Processing enrollment in course: ${courseName} (${courseId})`);

                    // Get completed contents (lessons) using GraphQL
                    const completedContents = await ThinkificGraphQL.getCompletedContents(
                        student.id,
                        courseId
                    );

                    console.log(`[SYNC] Found ${completedContents.length} completed contents for ${courseName}`);

                    // Process lesson completions
                    for (const content of completedContents) {
                        if (content.type === 'Lesson' && content.completedAt) {
                            const externalId = await createExternalId(
                                student.id,
                                content.id,
                                courseId,
                                content.completedAt
                            );

                            // Check if already exists
                            const existing = await base44.asServiceRole.entities.LessonCompletion.filter({
                                externalId
                            });

                            if (existing.length === 0) {
                                await base44.asServiceRole.entities.LessonCompletion.create({
                                    externalId,
                                    studentId: String(student.id),
                                    studentEmail: student.email,
                                    studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                                    lessonId: String(content.id),
                                    lessonName: content.name || 'Unknown Lesson',
                                    courseId: String(courseId),
                                    courseName: courseName,
                                    completedAt: content.completedAt
                                });

                                totalLessons++;
                                console.log(`[SYNC] ✓ Imported lesson: ${content.name}`);
                            }

                            // Track latest activity
                            const activityDate = new Date(content.completedAt);
                            if (!studentLatestActivity || activityDate > studentLatestActivity) {
                                studentLatestActivity = activityDate;
                            }
                        }
                    }

                    // Get quiz attempts using GraphQL
                    const quizAttempts = await ThinkificGraphQL.getQuizAttempts(student.id, courseId);
                    
                    console.log(`[SYNC] Found ${quizAttempts.length} quiz attempts for ${courseName}`);

                    for (const attempt of quizAttempts) {
                        if (attempt.submittedAt) {
                            const externalId = await createExternalId(
                                'quiz_attempt',
                                student.id,
                                attempt.quiz.id,
                                courseId,
                                attempt.submittedAt,
                                attempt.attemptNumber
                            );

                            // Check if already exists
                            const existing = await base44.asServiceRole.entities.QuizCompletion.filter({
                                externalId
                            });

                            if (existing.length === 0) {
                                await base44.asServiceRole.entities.QuizCompletion.create({
                                    externalId,
                                    studentId: String(student.id),
                                    studentEmail: student.email,
                                    studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                                    quizId: String(attempt.quiz.id),
                                    quizName: attempt.quiz.name || 'Unknown Quiz',
                                    courseId: String(courseId),
                                    courseName: courseName,
                                    score: attempt.score || 0,
                                    maxScore: attempt.maxScore || 0,
                                    percentage: attempt.percentageScore || 0,
                                    attemptNumber: attempt.attemptNumber || 1,
                                    completedAt: attempt.submittedAt,
                                    timeSpentSeconds: attempt.timeSpentSeconds || 0
                                });

                                totalQuizzes++;
                                console.log(`[SYNC] ✓ Imported quiz: ${attempt.quiz.name} (${attempt.percentageScore}%)`);
                            }

                            // Track latest activity
                            const activityDate = new Date(attempt.submittedAt);
                            if (!studentLatestActivity || activityDate > studentLatestActivity) {
                                studentLatestActivity = activityDate;
                            }
                        }
                    }
                }

                studentsProcessed++;
                console.log(`[SYNC] ✓ Completed sync for ${student.email}`);

            } catch (error) {
                console.error(`[SYNC] Error processing student ${student.email}:`, error);
                // Continue with next student
            }
        }

        const message = `Successfully synced ${totalLessons} lesson completions and ${totalQuizzes} quiz attempts for ${studentsProcessed} students`;
        console.log(`[SYNC] ${message}`);

        return Response.json({
            success: true,
            message,
            studentsProcessed,
            lessonsImported: totalLessons,
            quizzesImported: totalQuizzes
        });

    } catch (error) {
        console.error('[SYNC] Fatal error:', error);
        return Response.json({ 
            error: error.message,
            message: 'Sync failed. Check logs for details.'
        }, { status: 500 });
    }
});