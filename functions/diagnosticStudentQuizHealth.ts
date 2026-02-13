import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Diagnostic: Check quiz health for a student
 * 
 * Returns:
 *   - total quiz attempts
 *   - count by source (webhook vs csv)
 *   - count missing scorePercent (with breakdown by source)
 *   - count missing courseName (with breakdown by source)
 *   - CSV score column detection and parse failure count
 *   - sample 5 newest attempts
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        const body = await req.json();
        const { studentEmail } = body;
        
        if (!studentEmail) {
            return Response.json({ error: 'studentEmail required' }, { status: 400 });
        }
        
        const normalizedEmail = studentEmail.toLowerCase().trim();
        
        // Fetch all quiz events for this student
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-created_date', 5000);
        const quizEvents = allEvents.filter(e => 
            e.eventType === 'quiz_attempted' && 
            e.studentEmail?.toLowerCase?.() === normalizedEmail
        );
        
        console.log(`[DIAGNOSTIC] Found ${quizEvents.length} quiz attempts for ${normalizedEmail}`);
        
        // Count by source
        const bySource = {};
        quizEvents.forEach(e => {
            bySource[e.source || 'unknown'] = (bySource[e.source || 'unknown'] || 0) + 1;
        });
        
        // Count missing scorePercent by source
        const csvEvents = quizEvents.filter(e => e.source === 'csv_import');
        const webhookEvents = quizEvents.filter(e => e.source === 'webhook');
        const missingScorePercentCsv = csvEvents.filter(e => !Number.isFinite(e.scorePercent)).length;
        const missingScorePercentWebhook = webhookEvents.filter(e => !Number.isFinite(e.scorePercent)).length;
        const missingScorePercent = missingScorePercentCsv + missingScorePercentWebhook;
        
        // Count missing courseName by source
        const missingCourseNameCsv = csvEvents.filter(e => !e.courseName || e.courseName.trim() === '').length;
        const missingCourseNameWebhook = webhookEvents.filter(e => !e.courseName || e.courseName.trim() === '').length;
        const missingCourseName = missingCourseNameCsv + missingCourseNameWebhook;
        
        // Count CSV rows that have rawScore but scorePercent is still null (parse failures)
        const csvScoreParseFailures = csvEvents.filter(e => {
            const meta = e.metadata || {};
            return meta.rawScore && e.scorePercent === null;
        }).length;
        
        // Sample 5 newest
        const sorted = [...quizEvents].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
        const sample = sorted.slice(0, 5).map(e => ({
            quizName: e.contentTitle,
            courseName: e.courseName || null,
            scorePercent: Number.isFinite(e.scorePercent) ? e.scorePercent : null,
            attemptNumber: e.metadata?.attemptNumber || null,
            occurredAt: e.occurredAt,
            source: e.source,
            dedupeKey: e.dedupeKey
        }));
        
        return Response.json({
            studentEmail: normalizedEmail,
            totalQuizAttempts: quizEvents.length,
            bySource,
            missingScorePercent: {
                total: missingScorePercent,
                bySource: {
                    csv_import: missingScorePercentCsv,
                    webhook: missingScorePercentWebhook
                }
            },
            missingCourseName: {
                total: missingCourseName,
                bySource: {
                    csv_import: missingCourseNameCsv,
                    webhook: missingCourseNameWebhook
                }
            },
            csvScoreParseFailures,
            sampleNewest5: sample
        }, { status: 200 });
    } catch (error) {
        console.error('[DIAGNOSTIC QUIZ HEALTH] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});