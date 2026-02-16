import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This is a one-time admin function - no auth needed for this specific use
        const teacherEmail = 'weston@modalmath.com';
        
        // Get all webhook events for this teacher's students
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            source: 'webhook'
        });
        
        // Get teacher's student roster
        const studentAccessCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({
            createdByTeacherEmail: teacherEmail
        });
        
        const studentEmails = studentAccessCodes.map(s => s.studentEmail.toLowerCase().trim());
        
        // Get student profiles for the roster
        const allProfiles = await base44.asServiceRole.entities.StudentProfile.list('-created_date', 10000);
        const rosterProfiles = allProfiles.filter(p => p.email && studentEmails.includes(p.email.toLowerCase().trim()));
        const studentIds = rosterProfiles.map(p => p.thinkificUserId);
        
        // Filter events to only this teacher's students
        const teacherEvents = allEvents.filter(e => studentIds.includes(e.thinkificUserId));
        
        return Response.json({
            success: true,
            teacherEmail,
            totalStudents: studentIds.length,
            totalWebhookEvents: teacherEvents.length,
            recentEvents: teacherEvents.slice(0, 50).map(e => ({
                student: e.studentEmail,
                eventType: e.eventType,
                occurredAt: e.occurredAt,
                lessonName: e.lessonName,
                grade: e.grade
            }))
        });
    } catch (error) {
        console.error('Refresh dashboard error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});