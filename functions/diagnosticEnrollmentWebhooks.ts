import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const CLASSROOM_COURSE_ID = '552235';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        console.log('[DIAGNOSTIC] Checking webhook data for enrollment information');

        // Check WebhookEvent for enrollment.created events
        const enrollmentWebhooks = await base44.asServiceRole.entities.WebhookEvent.filter({ 
            topic: 'enrollment.created' 
        });

        console.log(`[DIAGNOSTIC] Found ${enrollmentWebhooks.length} enrollment.created webhooks`);

        // Parse webhook payloads to extract course enrollments for course 552235
        const classroomEnrollments = [];
        
        for (const webhook of enrollmentWebhooks) {
            try {
                const payload = JSON.parse(webhook.payloadJson);
                const courseId = String(payload?.payload?.course?.id || '');
                
                if (courseId === CLASSROOM_COURSE_ID) {
                    const email = payload?.payload?.user?.email?.toLowerCase().trim();
                    const userId = payload?.payload?.user?.id;
                    const enrollmentStatus = payload?.payload?.status;
                    
                    classroomEnrollments.push({
                        webhookId: webhook.webhookId,
                        receivedAt: webhook.receivedAt,
                        userId: userId,
                        email: email,
                        status: enrollmentStatus,
                        firstName: payload?.payload?.user?.first_name,
                        lastName: payload?.payload?.user?.last_name,
                        courseId: courseId,
                        courseName: payload?.payload?.course?.name
                    });
                }
            } catch (e) {
                console.error(`[DIAGNOSTIC] Failed to parse webhook ${webhook.webhookId}:`, e.message);
            }
        }

        // Group by email domain
        const teachers = classroomEnrollments.filter(e => !e.email?.endsWith('@modalmath.com'));
        const students = classroomEnrollments.filter(e => e.email?.endsWith('@modalmath.com'));

        // Get unique emails
        const uniqueTeachers = [...new Map(teachers.map(t => [t.email, t])).values()];
        const uniqueStudents = [...new Map(students.map(s => [s.email, s])).values()];

        return Response.json({
            summary: {
                totalEnrollmentWebhooks: enrollmentWebhooks.length,
                classroomEnrollments: classroomEnrollments.length,
                uniqueTeachers: uniqueTeachers.length,
                uniqueStudents: uniqueStudents.length
            },
            teachers: uniqueTeachers.sort((a, b) => a.email.localeCompare(b.email)),
            students: uniqueStudents.sort((a, b) => a.email.localeCompare(b.email)),
            allClassroomEnrollments: classroomEnrollments.sort((a, b) => 
                new Date(b.receivedAt) - new Date(a.receivedAt)
            )
        });

    } catch (error) {
        console.error('[DIAGNOSTIC] Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});