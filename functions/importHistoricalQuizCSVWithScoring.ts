// 🔒 PRODUCTION LOCKED – DO NOT MODIFY WITHOUT EXPLICIT APPROVAL

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only: Import historical quiz data from CSV with proper scoring
 * 
 * CSV columns (required):
 *   - Course Name (maps to courseName/Level)
 *   - Survey/Quiz Name (maps to quizName)
 *   - Student Name (maps to studentName)
 *   - Student Email (normalized lowercase)
 *   - Date Completed (UTC) (maps to occurredAt)
 *   - Total Number of Questions (optional)
 *   - Total Correct (optional, for correctCount)
 *   - % Score or variant (maps to scorePercent, handles "70" or "70%")
 * 
 * Creates quiz_attempted ActivityEvent with:
 *   - scorePercent: parsed from "% Score" or variant
 *   - attemptNumber: computed deterministically by grouping
 *   - correctCount/incorrectCount: derived from "Total Correct"
 */

async function createDedupeKey(data) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return 'csv:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Find column by name variants (case-insensitive, handles spaces)
 */
function getColumn(row, headerIndex, candidateNames) {
    const normalized = Object.fromEntries(
        Object.entries(headerIndex).map(([k, v]) => [
            k.toLowerCase().trim().replace(/\s+/g, ' '),
            v
        ])
    );
    
    for (const candidate of candidateNames) {
        const key = candidate.toLowerCase().trim().replace(/\s+/g, ' ');
        if (normalized[key] !== undefined) {
            return normalized[key];
        }
    }
    return -1;
}

/**
 * Parse percent value: "70%", "70", "0.7", "", etc.
 */
function parsePercent(value) {
    if (!value) return null;
    
    const str = String(value).trim();
    if (str === '' || str.toLowerCase() === 'n/a') return null;
    
    // Check if ends with %
    const hasPercent = str.endsWith('%');
    const numStr = str.replace('%', '').replace(/,/g, '').trim();
    
    const num = parseFloat(numStr);
    if (!Number.isFinite(num)) return null;
    
    // If 0-1 and no % sign, treat as fraction
    let result = num;
    if (!hasPercent && num >= 0 && num <= 1) {
        result = num * 100;
    }
    
    // Clamp to 0-100
    result = Math.max(0, Math.min(100, result));
    return result;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        const body = await req.json();
        const { csvText } = body;
        
        if (!csvText || !csvText.trim()) {
            return Response.json({ error: 'CSV text required' }, { status: 400 });
        }
        
        const lines = csvText.trim().split('\n');
        const headerLine = parseCSVLine(lines[0]);
        
        // Build header index (column name -> index)
        const headerIndex = Object.fromEntries(headerLine.map((h, i) => [h, i]));
        
        // Find column indices by name variants
        const courseNameIdx = getColumn(headerIndex, headerIndex, ['course name', 'Course Name']);
        const quizNameIdx = getColumn(headerIndex, headerIndex, ['survey/quiz name', 'quiz name', 'Survey/Quiz Name', 'Quiz Name']);
        const studentNameIdx = getColumn(headerIndex, headerIndex, ['student name', 'Student Name']);
        const studentEmailIdx = getColumn(headerIndex, headerIndex, ['student email', 'Student Email']);
        const dateIdx = getColumn(headerIndex, headerIndex, ['date completed (utc)', 'Date Completed (UTC)', 'date completed', 'Date Completed']);
        const totalQuestionsIdx = getColumn(headerIndex, headerIndex, ['total number of questions', 'Total Number of Questions', 'total questions', 'Total Questions']);
        const totalCorrectIdx = getColumn(headerIndex, headerIndex, ['total correct', 'Total Correct']);
        const scoreIdx = getColumn(headerIndex, headerIndex, ['% score', '% Score', 'percent score', 'Percent Score', 'score (%)', 'Score (%)', 'score percent', 'Score Percent', 'score_percent']);
        
        console.log('[QUIZ CSV] Headers detected:', Object.keys(headerIndex));
        console.log('[QUIZ CSV] Column indices:', { courseNameIdx, quizNameIdx, studentNameIdx, studentEmailIdx, dateIdx, totalCorrectIdx, scoreIdx });
        
        const scoreColumnDetected = scoreIdx !== -1;
        
        if (studentEmailIdx === -1 || quizNameIdx === -1 || dateIdx === -1) {
            return Response.json({ 
                error: 'CSV must have: Student Email, Survey/Quiz Name, Date Completed (UTC)' 
            }, { status: 400 });
        }
        
        let imported = 0;
        let duplicates = 0;
        let scoreParseFailures = 0;
        const errors = [];
        
        // First pass: collect all rows by (email, quiz, course, date) to compute attempt numbers
        const rowsByGroup = {};
        const allRows = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                const fields = parseCSVLine(line);
                const studentEmail = fields[studentEmailIdx]?.toLowerCase?.().trim() || '';
                const quizName = fields[quizNameIdx]?.trim() || '';
                const courseName = courseNameIdx !== -1 ? (fields[courseNameIdx]?.trim() || '') : '';
                const occurredAt = fields[dateIdx]?.trim() || '';
                
                if (!studentEmail || !quizName || !occurredAt) {
                    errors.push(`Row ${i + 1}: missing required fields`);
                    continue;
                }
                
                if (!studentEmail.toLowerCase().endsWith('@modalmath.com')) {
                    errors.push(`Row ${i + 1}: invalid email`);
                    continue;
                }
                
                const groupKey = `${studentEmail}|${quizName}|${courseName}`;
                if (!rowsByGroup[groupKey]) {
                    rowsByGroup[groupKey] = [];
                }
                
                allRows.push({ i, fields, studentEmail, quizName, courseName, occurredAt, groupKey });
            } catch (err) {
                errors.push(`Row ${i + 1}: parse error ${err.message}`);
            }
        }
        
        // Sort rows within each group by date to assign attempt numbers
        Object.values(rowsByGroup).forEach(group => {
            group.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
        });
        
        // Second pass: import with attempt numbers
        for (const row of allRows) {
            try {
                const { i, fields, studentEmail, quizName, courseName, occurredAt, groupKey } = row;
                const studentName = studentNameIdx !== -1 ? (fields[studentNameIdx]?.trim() || '') : '';
                const totalQuestions = totalQuestionsIdx !== -1 ? parseInt(fields[totalQuestionsIdx]) : null;
                const totalCorrect = totalCorrectIdx !== -1 ? parseInt(fields[totalCorrectIdx]) : null;
                
                // Parse score using new parser
                let scorePercent = null;
                let rawScore = null;
                if (scoreIdx !== -1) {
                    rawScore = fields[scoreIdx];
                    scorePercent = parsePercent(fields[scoreIdx]);
                    if (rawScore && scorePercent === null) {
                        scoreParseFailures++;
                        console.warn(`[QUIZ CSV] Row ${i + 1}: score parse failed for "${rawScore}"`);
                    }
                }
                
                // Compute attempt number
                const group = rowsByGroup[groupKey];
                const attemptIndex = group.findIndex(r => r.i === i);
                const attemptNumber = attemptIndex >= 0 ? attemptIndex + 1 : 1;
                
                // Compute incorrect count
                let incorrectCount = null;
                if (totalQuestions !== null && totalCorrect !== null) {
                    incorrectCount = totalQuestions - totalCorrect;
                }
                
                const dedupeKey = await createDedupeKey(`${studentEmail}|${quizName}|${courseName}|${occurredAt}`);
                
                // Check if exists
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existing.length > 0) {
                    duplicates++;
                    continue;
                }
                
                // Create activity event
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: '',
                    studentEmail: studentEmail,
                    studentDisplayName: studentName || studentEmail.split('@')[0],
                    courseId: '',
                    courseName: courseName || '',
                    eventType: 'quiz_attempted',
                    contentId: '',
                    contentTitle: quizName,
                    occurredAt: new Date(occurredAt).toISOString(),
                    source: 'csv_import',
                    rawEventId: '',
                    rawPayload: JSON.stringify({ line: fields.join(',') }),
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
                    metadata: {
                        attemptNumber: attemptNumber,
                        correctCount: totalCorrect,
                        incorrectCount: incorrectCount,
                        rawScore: rawScore
                    }
                });
                
                imported++;
                console.log(`[QUIZ CSV] Row ${i + 1}: ${studentEmail} / ${quizName} / attempt ${attemptNumber} / score ${scorePercent}%`);
            } catch (err) {
                errors.push(`Row ${i + 1}: ${err.message}`);
                console.error(`[QUIZ CSV] Row ${i + 1} error:`, err.message);
            }
        }
        
        return Response.json({
            imported,
            duplicates,
            total: allRows.length,
            scoreColumnDetected,
            scoreParseFailures,
            errors: errors.slice(0, 20)
        }, { status: 200 });
    } catch (error) {
        console.error('[QUIZ CSV IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});