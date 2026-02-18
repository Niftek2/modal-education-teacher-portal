import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();

        // Thinkific nests all event data inside body.payload
        const data = body.payload;

        if (!data?.lesson || !data?.user) {
            return Response.json({ error: 'Missing required lesson/user data' }, { status: 400 });
        }

        const studentEmail = data.user.email?.toLowerCase().trim();
        const lessonId = String(data.lesson.id);
        const lessonName = data.lesson.name;
        const chapterName = data.chapter?.name || '';
        const courseId = String(data.course?.id || '');
        const courseName = data.course?.name || '';
        const studentName = `${data.user.first_name || ''} ${data.user.last_name || ''}`.trim();
        const studentId = String(data.user.id || '');

        if (!studentEmail || !lessonId || !lessonName) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Create lesson completion record
        const lessonCompletion = await base44.asServiceRole.entities.LessonCompletion.create({
            studentId,
            studentEmail,
            studentName,
            lessonId,
            lessonName,
            courseId,
            courseName,
            completedAt: new Date().toISOString()
        });

        // Auto-complete matching StudentAssignment (keyed by email + lessonId)
        if (studentEmail && lessonId) {
            const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
                studentEmail,
                lessonId,
                status: 'assigned'
            });

            for (const assignment of assignments) {
                await base44.asServiceRole.entities.StudentAssignment.update(assignment.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    completedByEventId: lessonCompletion.id
                });
                console.log(`[receiveLessonCompletion] Marked Assignment ${assignment.id} as completed.`);
            }
        }

        return Response.json({ 
            success: true, 
            lessonCompletionId: lessonCompletion.id
        });
    } catch (error) {
        console.error('Receive lesson completion error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});