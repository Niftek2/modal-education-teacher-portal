import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ThinkificClient } from './lib/thinkificClient.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId } = await req.json();
        
        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log(`[BACKFILL] Starting lesson sync for group ${groupId}`);
        
        // Get all students in group (filtered by @modalmath.com)
        const allUsers = await ThinkificClient.getGroupUsers(groupId);
        const students = allUsers.filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'));
        
        console.log(`[BACKFILL] Found ${students.length} students (${allUsers.length} total users)`);
        
        const lessonCompletions = [];
        let processedCount = 0;

        for (const student of students) {
            processedCount++;
            console.log(`[BACKFILL] Processing student ${processedCount}/${students.length}: ${student.email}`);
            
            // Get all enrollments for this student
            const enrollments = await ThinkificClient.getEnrollmentsByUser(student.id);
            
            for (const enrollment of enrollments) {
                // Get course progress
                const progress = await ThinkificClient.getCourseProgress(student.id, enrollment.course_id);
                
                if (progress) {
                    // Track completed chapters as lessons
                    if (progress.completed_chapter_ids?.length > 0) {
                        for (const chapterId of progress.completed_chapter_ids) {
                            // Check if already exists to avoid duplicates
                            const existing = await base44.asServiceRole.entities.LessonCompletion.filter({
                                studentId: String(student.id),
                                lessonId: String(chapterId),
                                courseId: String(enrollment.course_id)
                            });

                            if (existing.length === 0) {
                                lessonCompletions.push({
                                    studentId: String(student.id),
                                    studentEmail: student.email,
                                    studentName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                                    lessonId: String(chapterId),
                                    lessonName: `Chapter ${chapterId}`,
                                    courseId: String(enrollment.course_id),
                                    courseName: enrollment.course_name || 'Unknown Course',
                                    completedAt: progress.updated_at || new Date().toISOString()
                                });
                            }
                        }
                    }
                }
            }
        }

        // Bulk create new lesson completions
        if (lessonCompletions.length > 0) {
            await base44.asServiceRole.entities.LessonCompletion.bulkCreate(lessonCompletions);
        }

        console.log(`[BACKFILL] Complete: ${lessonCompletions.length} new lesson completions added`);

        return Response.json({ 
            success: true, 
            lessonsImported: lessonCompletions.length,
            studentsProcessed: students.length,
            message: `Imported ${lessonCompletions.length} lesson completions for ${students.length} students`
        });
    } catch (error) {
        console.error('[BACKFILL] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});