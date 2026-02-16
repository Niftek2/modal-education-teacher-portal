import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Diagnostic endpoint to verify student quiz scores from both webhook and CSV sources
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        const normalizedEmail = studentEmail.trim().toLowerCase();

        // Fetch all quiz attempts for this student
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({
            studentEmail: normalizedEmail,
            eventType: 'quiz_attempted'
        }, '-occurredAt', 1000);

        // Get the newest 10
        const newest10 = events.slice(0, 10);

        const results = newest10.map(event => {
            const metadata = event.metadata || {};
            return {
                source: event.source,
                contentTitle: event.contentTitle,
                courseName: event.courseName,
                occurredAt: event.occurredAt,
                scorePercent: event.scorePercent,
                attemptNumber: metadata.attemptNumber,
                correctCount: metadata.correctCount,
                totalQuestions: metadata.totalQuestions,
                rawPercentScore: metadata.rawPercentScore,
                dedupeKey: event.dedupeKey
            };
        });

        return Response.json({
            studentEmail: normalizedEmail,
            totalQuizAttempts: events.length,
            newest10: results,
            sourceBreakdown: {
                webhook: events.filter(e => e.source === 'webhook').length,
                csv_import: events.filter(e => e.source === 'csv_import').length,
                rest_backfill: events.filter(e => e.source === 'rest_backfill').length
            }
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});