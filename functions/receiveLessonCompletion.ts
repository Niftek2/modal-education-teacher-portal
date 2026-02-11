import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();

        // Validate required fields
        if (!payload.user_id || !payload.lesson_id || !payload.lesson_name) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Create lesson completion record
        const lessonCompletion = await base44.asServiceRole.entities.LessonCompletion.create({
            studentId: String(payload.user_id),
            studentEmail: payload.user_email || '',
            studentName: payload.user_name || '',
            lessonId: String(payload.lesson_id),
            lessonName: payload.lesson_name,
            courseId: payload.course_id ? String(payload.course_id) : '',
            courseName: payload.course_name || '',
            completedAt: new Date().toISOString()
        });

        return Response.json({ 
            success: true, 
            lessonCompletionId: lessonCompletion.id
        });
    } catch (error) {
        console.error('Receive lesson completion error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});