import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { parse } from 'npm:csv-parse@5.5.6/sync';

async function createDedupeKey(data) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return 'csv_quiz_attempted:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 40);
}

function parsePercentScore(value) {
    if (value === null || value === undefined || value === '') return null;
    
    let stringVal = String(value).trim();
    
    // Handle "NA" or similar
    if (stringVal.toLowerCase() === 'na' || stringVal.toLowerCase() === 'n/a') return null;
    
    // Remove % sign if present
    stringVal = stringVal.replace('%', '');
    
    const num = Number(stringVal);
    if (Number.isNaN(num)) return null;
    
    // If value is between 0 and 1, treat as decimal (0.7 = 70%)
    if (num > 0 && num < 1) {
        return num * 100;
    }
    
    // If value is between 1 and 100, treat as percentage
    if (num >= 0 && num <= 100) {
        return num;
    }
    
    // Invalid range
    return null;
}

function preflightValidate(rows) {
    const errors = [];
    const warnings = [];
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 1;
        
        // Check for missing required columns
        if (!row['Student Email']) {
            errors.push(`Row ${rowNum}: Missing 'Student Email'`);
        }
        if (!row['Survey/Quiz Name']) {
            errors.push(`Row ${rowNum}: Missing 'Survey/Quiz Name'`);
        }
        if (!row['Date Completed (UTC)']) {
            errors.push(`Row ${rowNum}: Missing 'Date Completed (UTC)'`);
        }
        
        // Detect column shift issues
        const totalQuestions = row['Total Number of Questions'];
        if (totalQuestions && Number(totalQuestions) > 100) {
            warnings.push(`Row ${rowNum}: Suspicious 'Total Number of Questions' = ${totalQuestions} (expected < 100, possible column shift)`);
        }
        
        // Check if % Score looks like Total Correct
        const percentScore = row['% Score'];
        const totalCorrect = row['Total Correct'];
        if (percentScore && totalCorrect && Number(percentScore) === Number(totalCorrect)) {
            warnings.push(`Row ${rowNum}: '% Score' (${percentScore}) matches 'Total Correct' (${totalCorrect}) - possible data error`);
        }
    }
    
    return { errors, warnings };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { csvText } = await req.json();

        if (!csvText || typeof csvText !== 'string') {
            return Response.json({ error: 'Invalid or empty csvText' }, { status: 400 });
        }

        // Parse CSV using proper CSV parser that handles quotes and commas
        let records;
        try {
            records = parse(csvText, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_quotes: true
            });
        } catch (parseError) {
            return Response.json({ error: `CSV Parse Error: ${parseError.message}` }, { status: 400 });
        }

        if (!Array.isArray(records) || records.length === 0) {
            return Response.json({ error: 'No valid records found in CSV' }, { status: 400 });
        }

        // Preflight validation
        const validation = preflightValidate(records);
        if (validation.errors.length > 0) {
            return Response.json({ 
                error: 'Validation failed', 
                validationErrors: validation.errors,
                validationWarnings: validation.warnings
            }, { status: 400 });
        }

        let imported = 0;
        let duplicates = 0;
        let errors = [];
        const warnings = validation.warnings;

        for (const row of records) {
            const studentEmail = row['Student Email']?.trim().toLowerCase();
            const courseName = row['Course Name']?.trim() || '';
            const contentTitle = row['Survey/Quiz Name']?.trim() || '';
            
            // CRITICAL: % Score must ONLY come from the % Score column
            const rawPercentScore = row['% Score'];
            const scorePercent = parsePercentScore(rawPercentScore);
            
            // Parse date: "February 12, 2026 21:16"
            let occurredAt = null;
            if (row['Date Completed (UTC)']) {
                try {
                    const dateStr = row['Date Completed (UTC)'].trim();
                    const d = new Date(dateStr);
                    if (!Number.isNaN(d.getTime())) {
                        occurredAt = d.toISOString();
                    }
                } catch (e) {
                    // Skip if date parse fails
                }
            }

            if (!studentEmail || !contentTitle || !occurredAt) {
                errors.push({
                    row: row,
                    reason: 'Missing required fields (email, quiz name, or date)'
                });
                continue;
            }

            // Create CSV-specific dedupeKey to avoid collision with webhook events
            const dedupeData = `${studentEmail}|${courseName}|${contentTitle}|${occurredAt}|${scorePercent}`;
            const dedupeKey = await createDedupeKey(dedupeData);

            // Check if already exists
            const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ 
                dedupeKey: dedupeKey 
            });

            if (existing.length > 0) {
                duplicates++;
                continue;
            }

            try {
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: 'historical_import',
                    thinkificUserId: 0,
                    studentEmail: studentEmail,
                    studentDisplayName: row['Student Name']?.trim() || studentEmail.split('@')[0],
                    courseId: '',
                    courseName: courseName,
                    eventType: 'quiz_attempted',
                    contentId: '',
                    contentTitle: contentTitle,
                    occurredAt: occurredAt,
                    source: 'csv_import',
                    rawEventId: '',
                    rawPayload: JSON.stringify(row),
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
                    metadata: {
                        totalQuestions: row['Total Number of Questions'] ? Number(row['Total Number of Questions']) : null,
                        correctCount: row['Total Correct'] ? Number(row['Total Correct']) : null,
                        rawPercentScore: rawPercentScore,
                        rawCSVRow: row,
                        importedAt: new Date().toISOString()
                    }
                });
                imported++;
            } catch (error) {
                errors.push({
                    row: row,
                    reason: error.message
                });
            }
        }

        return Response.json({
            success: true,
            imported,
            duplicates,
            errors,
            warnings,
            total: records.length
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});