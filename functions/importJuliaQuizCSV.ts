import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] ? values[index].trim() : '';
        });
        rows.push(row);
    }
    
    return rows;
}

function parseDate(dateStr) {
    // Parse format: "May 28, 2025 18:54"
    const months = {
        'January': 0, 'February': 1, 'March': 2, 'April': 3,
        'May': 4, 'June': 5, 'July': 6, 'August': 7,
        'September': 8, 'October': 9, 'November': 10, 'December': 11
    };
    
    const parts = dateStr.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)/);
    if (!parts) return new Date();
    
    const [, month, day, year, hour, minute] = parts;
    return new Date(parseInt(year), months[month], parseInt(day), parseInt(hour), parseInt(minute));
}

async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { csvUrl } = await req.json();
        
        if (!csvUrl) {
            return Response.json({ error: 'csvUrl is required' }, { status: 400 });
        }

        // Fetch CSV
        const csvResponse = await fetch(csvUrl);
        if (!csvResponse.ok) {
            return Response.json({ error: 'Failed to fetch CSV' }, { status: 400 });
        }
        
        const csvText = await csvResponse.text();
        const rows = await parseCSV(csvText);
        
        let imported = 0;
        let skipped = 0;
        const errors = [];

        for (const row of rows) {
            try {
                const studentEmail = row['Student Email']?.toLowerCase().trim();
                const courseName = row['Course Name'];
                const quizName = row['Survey/Quiz Name'];
                const dateCompleted = row['Date Completed (UTC)'];
                const totalQuestions = parseInt(row['Total Number of Questions']) || 0;
                const totalCorrect = parseInt(row['Total Correct']) || 0;
                const scorePercent = parseInt(row['% Score']) || 0;

                if (!studentEmail || !courseName || !quizName || !dateCompleted) {
                    skipped++;
                    continue;
                }

                // Only import for juliahm@modalmath.com
                if (studentEmail !== 'juliahm@modalmath.com') {
                    skipped++;
                    continue;
                }

                const occurredAt = parseDate(dateCompleted);
                const dedupeKey = await hashString(
                    `csv-julia-quiz-import:${studentEmail}:${quizName}:${dateCompleted}`
                );

                // Check if already exists
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({
                    dedupeKey: dedupeKey
                });

                if (existing && existing.length > 0) {
                    skipped++;
                    continue;
                }

                // Create ActivityEvent
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentEmail: studentEmail,
                    studentUserId: 'unknown',
                    thinkificUserId: 0,
                    studentDisplayName: row['Student Name'] || 'Julia M',
                    courseName: courseName,
                    eventType: 'quiz_attempted',
                    contentTitle: quizName,
                    occurredAt: occurredAt.toISOString(),
                    source: 'csv_import',
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
                    metadata: {
                        totalQuestions: totalQuestions,
                        correctCount: totalCorrect,
                        incorrectCount: totalQuestions - totalCorrect,
                        importSource: 'julia_csv_import'
                    }
                });

                imported++;
            } catch (error) {
                errors.push({ row: row['Survey/Quiz Name'], error: error.message });
            }
        }

        return Response.json({
            success: true,
            imported,
            skipped,
            errors,
            message: `Imported ${imported} quiz results for Julia M`
        });

    } catch (error) {
        console.error('Import error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});