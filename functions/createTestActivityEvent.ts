import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Create a test ActivityEvent to verify UI reads from database correctly
 * Uses teacher's own email
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        // Create a test activity event
        const testEvent = await base44.asServiceRole.entities.ActivityEvent.create({
            studentUserId: user.id,
            studentEmail: user.email,
            studentDisplayName: user.full_name || user.email,
            courseId: 'test-course-123',
            courseName: 'Test Course',
            eventType: 'quiz_attempted',
            contentId: 'test-quiz-456',
            contentTitle: 'Test Quiz',
            occurredAt: new Date().toISOString(),
            source: 'manual_test',
            rawEventId: 'test-' + crypto.randomUUID(),
            rawPayload: JSON.stringify({ test: true, createdAt: new Date().toISOString() }),
            dedupeKey: 'test-' + crypto.randomUUID().substring(0, 16),
            metadata: {
                score: 85,
                maxScore: 100,
                percentage: 85
            }
        });
        
        return Response.json({
            success: true,
            eventId: testEvent.id,
            message: 'Test activity event created'
        });
    } catch (error) {
        console.error('Create test event error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});