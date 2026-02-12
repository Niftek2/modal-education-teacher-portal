import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { studentEmail } = await req.json();
        
        if (!studentEmail) {
            return Response.json({ error: 'studentEmail required' }, { status: 400 });
        }

        const normalizedEmail = studentEmail.trim().toLowerCase();

        // Fetch all events for this student
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list();
        const studentEvents = allEvents.filter(e => e.studentEmail?.trim().toLowerCase() === normalizedEmail);
        
        // Count by event type
        const eventCounts = {};
        studentEvents.forEach(e => {
            eventCounts[e.eventType] = (eventCounts[e.eventType] || 0) + 1;
        });

        // Get sample lesson.completed events
        const lessonEvents = studentEvents
            .filter(e => e.eventType === 'lesson.completed')
            .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
            .slice(0, 3);

        const samplePayloads = lessonEvents.map(e => {
            try {
                return JSON.parse(e.rawPayload);
            } catch {
                return e.rawPayload;
            }
        });

        return Response.json({
            studentEmail,
            totalEvents: studentEvents.length,
            eventCounts,
            lessonCompletedCount: eventCounts['lesson.completed'] || 0,
            sampleLessonPayloads: samplePayloads,
            sampleEvents: lessonEvents.map(e => ({
                id: e.id,
                eventType: e.eventType,
                contentTitle: e.contentTitle,
                courseName: e.courseName,
                occurredAt: e.occurredAt,
                source: e.source
            }))
        });
    } catch (error) {
        console.error('[DIAGNOSTIC] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});