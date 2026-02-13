import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Find all quiz attempts with missing or "Unknown Course" courseName
        const quizEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'quiz_attempted'
        });

        let scanned = 0;
        let repaired = 0;
        let stillUnknown = 0;
        const repairLog = [];

        for (const event of quizEvents) {
            scanned++;
            const courseName = event.courseName || '';
            
            // Check if needs repair
            if (!courseName.trim() || courseName === 'Unknown Course') {
                const metadata = event.metadata || {};
                const lessonId = metadata.lessonId || event.contentId; // Try metadata first, then contentId as fallback
                
                if (lessonId) {
                    try {
                        const mapping = await base44.asServiceRole.entities.LessonCourseMap.filter({
                            lessonId: String(lessonId)
                        });
                        
                        if (mapping.length > 0) {
                            const newCourseName = mapping[0].courseName;
                            const newCourseId = mapping[0].courseId;
                            
                            await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                                courseName: newCourseName,
                                courseId: newCourseId
                            });
                            
                            repaired++;
                            repairLog.push({
                                eventId: event.id,
                                quizName: event.contentTitle,
                                oldCourseName: courseName || '(empty)',
                                newCourseName: newCourseName,
                                lessonId: String(lessonId)
                            });
                        } else {
                            stillUnknown++;
                        }
                    } catch (error) {
                        console.error(`[REPAIR] Failed to repair event ${event.id}:`, error.message);
                    }
                } else {
                    stillUnknown++;
                }
            }
        }

        console.log(`[REPAIR] Scanned: ${scanned}, Repaired: ${repaired}, Still Unknown: ${stillUnknown}`);

        return Response.json({
            scanned,
            repaired,
            stillUnknown,
            repairLog
        });
    } catch (error) {
        console.error('[REPAIR] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});