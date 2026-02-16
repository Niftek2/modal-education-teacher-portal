import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * FIX: Update existing csv_import records for Weston with correct data
 * Updates records where lessonName or grade is null
 */

const WESTON_EMAIL = 'weston@modalmath.com';
const WESTON_USER_ID = 236589658;

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    console.log('[FIX] CSV Headers:', JSON.stringify(headers));
    
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx] || null;
        });
        rows.push(row);
    }
    
    return rows;
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr + ' UTC');
        return date.toISOString();
    } catch {
        return null;
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        const body = await req.json();
        const { fileUrl } = body;
        
        if (!fileUrl) {
            return Response.json({ error: 'fileUrl required' }, { status: 400 });
        }
        
        // Fetch existing csv_import records with null fields
        const nullRecords = await base44.asServiceRole.entities.ActivityEvent.filter({
            thinkificUserId: WESTON_USER_ID,
            source: 'csv_import'
        });
        
        const toUpdate = nullRecords.filter(r => r.lessonName == null || r.grade == null);
        console.log(`[FIX] Found ${toUpdate.length} csv_import records with null lessonName or grade`);
        
        // Fetch CSV content
        const csvResponse = await fetch(fileUrl);
        const csvText = await csvResponse.text();
        const rows = parseCSV(csvText);
        
        console.log(`[FIX] Total CSV rows: ${rows.length}`);
        console.log('[FIX] Sample row keys:', Object.keys(rows[0] || {}));
        
        // Filter for Weston only
        const westonRows = rows.filter(row => {
            const email = (row['Student Email'] || '').toLowerCase().trim();
            return email === WESTON_EMAIL;
        });
        
        console.log(`[FIX] Weston rows in CSV: ${westonRows.length}`);
        
        // Build lookup map by occurredAt
        const csvLookup = new Map();
        for (const row of westonRows) {
            const dateCompleted = row['Date Completed (UTC)'];
            const occurredAt = parseDate(dateCompleted);
            if (occurredAt) {
                csvLookup.set(occurredAt, row);
            }
        }
        
        let updated = 0;
        let skipped = 0;
        const samples = [];
        
        for (const record of toUpdate) {
            try {
                const csvRow = csvLookup.get(record.occurredAt);
                
                if (!csvRow) {
                    console.log(`[FIX] No CSV match for ${record.occurredAt}`);
                    skipped++;
                    continue;
                }
                
                // Extract correct fields
                const quizName = (csvRow['Survey/Quiz Name'] || '').trim();
                const scoreStr = csvRow['% Score'];
                const totalCorrect = csvRow['Total Correct'];
                const totalQuestions = csvRow['Total Number of Questions'];
                const courseName = csvRow['Course Name'];
                
                // Parse values
                const grade = Number(scoreStr);
                const correctCount = Number(totalCorrect);
                const totalCount = Number(totalQuestions);
                const incorrectCount = totalCount - correctCount;
                
                if (!quizName || isNaN(grade)) {
                    console.log(`[FIX] Invalid data for ${record.id}`);
                    skipped++;
                    continue;
                }
                
                // Update the record
                await base44.asServiceRole.entities.ActivityEvent.update(record.id, {
                    lessonName: quizName,
                    grade: grade,
                    courseName: courseName || record.courseName,
                    correctCount: !isNaN(correctCount) ? correctCount : record.correctCount,
                    incorrectCount: !isNaN(incorrectCount) ? incorrectCount : record.incorrectCount
                });
                
                console.log(`[FIX] ✓ Updated ${record.id}: "${quizName}" - ${grade}%`);
                updated++;
                
                if (samples.length < 5) {
                    samples.push({
                        id: record.id,
                        lessonName: quizName,
                        grade: grade,
                        occurredAt: record.occurredAt
                    });
                }
            } catch (error) {
                console.error(`[FIX] Error updating ${record.id}:`, error.message);
                skipped++;
            }
        }
        
        return Response.json({
            success: true,
            summary: {
                recordsFound: toUpdate.length,
                updated,
                skipped,
                samples
            }
        });
    } catch (error) {
        console.error('[FIX] Fatal error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});