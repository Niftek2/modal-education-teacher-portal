import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * ONE-TIME CSV IMPORT: Weston quiz data only
 * Does NOT overwrite webhook records
 * Strict duplicate checking
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
    // Format: "February 16, 2026 22:02"
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr + ' UTC');
        return date.toISOString();
    } catch {
        return null;
    }
}

async function isDuplicate(base44, thinkificUserId, lessonName, attemptNumber, occurredAt) {
    // Check for existing record with same key fields
    const existing = await base44.asServiceRole.entities.ActivityEvent.filter({
        thinkificUserId,
        eventType: 'quiz_attempted'
    });
    
    // Match on lessonName and occurredAt (same quiz at same time = duplicate)
    const normalizedLessonName = (lessonName || '').toLowerCase().trim();
    const occurredDate = occurredAt ? new Date(occurredAt).getTime() : 0;
    
    for (const record of existing) {
        const recordLessonName = (record.lessonName || '').toLowerCase().trim();
        const recordDate = record.occurredAt ? new Date(record.occurredAt).getTime() : 0;
        
        // Same lesson name and within 1 minute = duplicate
        if (recordLessonName === normalizedLessonName && 
            Math.abs(recordDate - occurredDate) < 60000) {
            return true;
        }
    }
    
    return false;
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
        
        // Fetch CSV content
        const csvResponse = await fetch(fileUrl);
        const csvText = await csvResponse.text();
        const rows = parseCSV(csvText);
        
        console.log(`[IMPORT] Total CSV rows: ${rows.length}`);
        
        // Filter for Weston only
        const westonRows = rows.filter(row => {
            const email = (row['Student Email'] || '').toLowerCase().trim();
            return email === WESTON_EMAIL;
        });
        
        console.log(`[IMPORT] Weston rows: ${westonRows.length}`);
        
        let inserted = 0;
        let skipped = 0;
        const samples = [];
        
        for (const row of westonRows) {
            try {
                // Extract fields
                const courseName = row['Course Name'];
                const quizName = (row['Survey/Quiz Name'] || '').trim();
                const dateCompleted = row['Date Completed (UTC)'];
                const scoreStr = row['% Score'];
                const totalCorrect = row['Total Correct'];
                const totalQuestions = row['Total Number of Questions'];
                
                // Parse values
                const grade = Number(scoreStr);
                const correctCount = Number(totalCorrect);
                const totalCount = Number(totalQuestions);
                const incorrectCount = totalCount - correctCount;
                const occurredAt = parseDate(dateCompleted);
                
                // Validation
                if (!quizName || !occurredAt || isNaN(grade)) {
                    console.log(`[IMPORT] Skipping invalid row: ${quizName}`);
                    skipped++;
                    continue;
                }
                
                // Check for duplicate
                const duplicate = await isDuplicate(
                    base44,
                    WESTON_USER_ID,
                    quizName,
                    1, // CSV doesn't have attempt number, assume 1
                    occurredAt
                );
                
                if (duplicate) {
                    console.log(`[IMPORT] Skipping duplicate: ${quizName} at ${occurredAt}`);
                    skipped++;
                    continue;
                }
                
                // Create deduplication key
                const dedupeKey = `csv_import:${WESTON_USER_ID}:${quizName}:${occurredAt}`;
                
                // Create activity event
                const activity = {
                    thinkificUserId: WESTON_USER_ID,
                    source: 'csv_import',
                    eventType: 'quiz_attempted',
                    occurredAt,
                    dedupeKey,
                    courseName: courseName || null,
                    lessonName: quizName,
                    grade: grade, // Store as-is from % Score
                    attemptNumber: 1, // CSV doesn't track attempts
                    correctCount: !isNaN(correctCount) ? correctCount : null,
                    incorrectCount: !isNaN(incorrectCount) ? incorrectCount : null,
                    studentEmail: WESTON_EMAIL,
                    studentDisplayName: 'Weston R',
                    rawPayload: JSON.stringify(row)
                };
                
                await base44.asServiceRole.entities.ActivityEvent.create(activity);
                
                console.log(`[IMPORT] ✓ Inserted: ${quizName} - ${grade}%`);
                inserted++;
                
                if (samples.length < 3) {
                    samples.push({
                        lessonName: quizName,
                        grade: grade,
                        occurredAt
                    });
                }
            } catch (error) {
                console.error(`[IMPORT] Error processing row:`, error.message);
                skipped++;
            }
        }
        
        return Response.json({
            success: true,
            summary: {
                totalCSVRows: rows.length,
                westonRows: westonRows.length,
                inserted,
                skipped,
                samples
            }
        });
    } catch (error) {
        console.error('[IMPORT] Fatal error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});