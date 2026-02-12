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

        const { csvData } = await req.json();
        
        if (!csvData || !Array.isArray(csvData)) {
            return Response.json({ error: 'csvData array required' }, { status: 400 });
        }

        let imported = 0;
        let duplicates = 0;
        let errors = [];

        for (const row of csvData) {
            try {
                const studentEmail = row['Student Email']?.trim().toLowerCase();
                const studentName = row['Student Name'] || '';
                const courseName = row['Course Name'] || ''; // This is the "Level"
                const quizName = row['Survey/Quiz Name'] || '';
                const dateStr = row['Date Completed (UTC)'] || '';
                const totalCorrect = parseInt(row['Total Correct']) || 0;
                const totalQuestions = parseInt(row['Total Number of Questions']) || 1;
                const percentage = parseInt(row['% Score']) || 0;

                if (!studentEmail || !quizName || !dateStr) {
                    errors.push({ row, reason: 'Missing required fields' });
                    continue;
                }

                // Parse date: "February 12, 2026 21:16"
                const occurredAt = new Date(dateStr);
                if (isNaN(occurredAt.getTime())) {
                    errors.push({ row, reason: 'Invalid date format' });
                    continue;
                }

                const occurredAtIso = occurredAt.toISOString();
                const dedupeKey = `${studentEmail}-${quizName}-${occurredAtIso}`;

                // Check for duplicates
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({
                    studentEmail: studentEmail,
                    eventType: 'quiz.attempted',
                    contentTitle: quizName,
                    occurredAt: occurredAtIso
                });

                if (existing.length > 0) {
                    duplicates++;
                    continue;
                }

                // Create ActivityEvent
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: '',
                    studentEmail: studentEmail,
                    studentDisplayName: studentName || studentEmail.split('@')[0],
                    courseId: '',
                    courseName: courseName,
                    eventType: 'quiz.attempted',
                    contentId: '',
                    contentTitle: quizName,
                    occurredAt: occurredAtIso,
                    source: 'rest_backfill',
                    rawEventId: '',
                    rawPayload: JSON.stringify(row),
                    dedupeKey: dedupeKey,
                    metadata: {
                        grade: percentage,
                        correctCount: totalCorrect,
                        incorrectCount: totalQuestions - totalCorrect
                    }
                });

                imported++;
            } catch (error) {
                errors.push({ row, reason: error.message });
            }
        }

        return Response.json({
            success: true,
            imported,
            duplicates,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Import error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});