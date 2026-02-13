import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { csvData } = await req.json();

        if (!csvData) {
            return Response.json({ error: 'Missing csvData' }, { status: 400 });
        }

        // Simple CSV parser that handles quoted fields
        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim().replace(/^"|"$/g, ''));
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim().replace(/^"|"$/g, ''));
            return result;
        };
        
        const lines = csvData.trim().split('\n');
        const headers = parseCSVLine(lines[0]);
        
        let imported = 0;
        let duplicates = 0;
        let errors = 0;

        for (let i = 1; i < lines.length; i++) {
            try {
                const values = parseCSVLine(lines[i]);
                const row = {};
                headers.forEach((h, idx) => {
                    row[h] = values[idx];
                });

                const studentEmail = row['Student Email']?.toLowerCase();
                const quizName = row['Survey/Quiz Name']?.trim();
                const courseName = row['Course Name']?.trim();
                const scorePercent = row['% Score'] ? Number(row['% Score']) : null;
                const dateStr = row['Date Completed (UTC)'];

                if (!studentEmail || !quizName || !Number.isFinite(scorePercent)) {
                    continue;
                }

                // Parse date like "February 12, 2026 21:16"
                const occurredAt = new Date(dateStr).toISOString();
                const dedupeKey = `csv_${studentEmail}_${quizName}_${occurredAt}`;

                // Check if already exists
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({
                    dedupeKey: dedupeKey
                });

                if (existing.length > 0) {
                    duplicates++;
                    continue;
                }

                // Create activity event
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: '',
                    studentEmail: studentEmail,
                    studentDisplayName: studentEmail.split('@')[0],
                    courseId: '',
                    courseName: courseName || 'Elementary',
                    eventType: 'quiz_attempted',
                    contentId: '',
                    contentTitle: quizName,
                    occurredAt: occurredAt,
                    source: 'rest_backfill',
                    rawEventId: '',
                    rawPayload: JSON.stringify(row),
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
                    metadata: {}
                });

                imported++;
            } catch (error) {
                console.error(`Error processing row ${i}:`, error.message);
                errors++;
            }
        }

        return Response.json({
            imported,
            duplicates,
            errors,
            total: lines.length - 1
        });
    } catch (error) {
        console.error('[IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});