import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ThinkificClient } from './lib/thinkificClient.js';

async function createExternalId(userId, quizId, lessonId, createdAt) {
    const data = `${userId}-${quizId}-${lessonId || 'none'}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function createLessonExternalId(userId, lessonId, courseId, createdAt) {
    const data = `${userId}-${lessonId}-${courseId || 'none'}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId } = await req.json();

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log(`[BACKFILL] Starting backfill for group ${groupId}`);

        // Get all students in group
        const allUsers = await ThinkificClient.getGroupUsers(groupId);
        const students = allUsers.filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'));

        console.log(`[BACKFILL] Found ${students.length} students`);

        let quizzesAdded = 0;
        let lessonsAdded = 0;
        let studentsProcessed = 0;

        for (const student of students) {
            studentsProcessed++;
            console.log(`[BACKFILL] Processing ${studentsProcessed}/${students.length}: ${student.email}`);

            // Backfill quiz.attempted events
            try {
                const quizEvents = await ThinkificClient.getUserEvents(student.id, 'quiz.attempted');
                
                for (const event of quizEvents) {
                    const payload = event.payload || {};
                    
                    // Create stable external ID
                    let externalId;
                    if (payload.quiz_attempt?.id) {
                        externalId = `quiz_attempt_${payload.quiz_attempt.id}`;
                    } else {
                        externalId = await createExternalId(
                            student.id,
                            payload.quiz_id || event.object_id,
                            payload.lesson_id,
                            event.occurred_at
                        );
                    }

                    // Check if exists by externalId
                    const existing = await base44.asServiceRole.entities.QuizCompletion.filter({
                        externalId
                    });

                    if (existing.length === 0) {
                        const score = payload.score ?? payload.quiz_attempt?.score ?? 0;
                        const maxScore = payload.max_score ?? payload.quiz_attempt?.max_score ?? 100;
                        const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

                        await base44.asServiceRole.entities.QuizCompletion.create({
                            externalId,
                            studentId: String(student.id),
                            studentEmail: student.email,
                            studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                            quizId: String(payload.quiz_id || event.object_id || ''),
                            quizName: payload.quiz_name || 'Unknown Quiz',
                            courseId: String(payload.course_id || ''),
                            courseName: payload.course_name || '',
                            score,
                            maxScore,
                            percentage,
                            attemptNumber: payload.attempt_number || 1,
                            completedAt: event.occurred_at || new Date().toISOString(),
                            timeSpentSeconds: payload.time_spent_seconds || 0
                        });
                        quizzesAdded++;
                    }
                }
            } catch (error) {
                console.error(`[BACKFILL] Quiz error for ${student.email}:`, error);
            }

            // Backfill lesson.completed events
            try {
                const lessonEvents = await ThinkificClient.getUserEvents(student.id, 'lesson.completed');
                
                for (const event of lessonEvents) {
                    const payload = event.payload || {};
                    
                    // Create stable external ID for lesson
                    const externalId = await createLessonExternalId(
                        student.id,
                        payload.lesson_id || event.object_id,
                        payload.course_id,
                        event.occurred_at
                    );

                    // Check if exists by externalId
                    const existing = await base44.asServiceRole.entities.LessonCompletion.filter({
                        externalId
                    });

                    if (existing.length === 0) {
                        await base44.asServiceRole.entities.LessonCompletion.create({
                            externalId,
                            studentId: String(student.id),
                            studentEmail: student.email,
                            studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                            lessonId: String(payload.lesson_id || event.object_id || ''),
                            lessonName: payload.lesson_name || 'Unknown Lesson',
                            courseId: String(payload.course_id || ''),
                            courseName: payload.course_name || '',
                            completedAt: event.occurred_at || new Date().toISOString()
                        });
                        lessonsAdded++;
                    }
                }
            } catch (error) {
                console.error(`[BACKFILL] Lesson error for ${student.email}:`, error);
            }
        }

        console.log(`[BACKFILL] Complete: ${quizzesAdded} quizzes, ${lessonsAdded} lessons`);

        return Response.json({
            success: true,
            studentsProcessed,
            quizzesAdded,
            lessonsAdded,
            message: `Backfilled ${quizzesAdded} quizzes and ${lessonsAdded} lessons for ${studentsProcessed} students`
        });

    } catch (error) {
        console.error('[BACKFILL] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});