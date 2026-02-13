import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only function: Repair quiz scores from CSV upload
 * 
 * Patches existing ActivityEvent rows (source="csv_import", scorePercent null)
 * by matching to CSV rows via: studentEmail + quizName + courseName + occurredAt
 * 
 * Update-only, no inserts.
 */

function getColumn(headers, names) {
    for (const name of names) {
        const idx = headers.findIndex(h => h.toLowerCase().trim() === name.toLowerCase().trim());
        if (idx !== -1) return idx;
    }
    return -1;
}

function parsePercent(value) {
    if (!value || typeof value !== 'string') return null;
    
    value = value.trim();
    if (!value || value.toLowerCase() === 'n/a') return null;
    
    // Remove % if present
    if (value.endsWith('%')) {
        value = value.slice(0, -1).trim();
    }
    
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return null;
    
    // If decimal between 0-1, convert to percent; otherwise assume already percent
    if (parsed >= 0 && parsed <= 1) {
        return parsed * 100;
    }
    if (parsed >= 0 && parsed <= 100) {
        return parsed;
    }
    
    return null;
}

function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());
    
    return fields;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }
        
        const { csvText } = await req.json();
        if (!csvText || typeof csvText !== 'string') {
            return Response.json({ error: 'Missing or invalid csvText' }, { status: 400 });
        }
        
        // Fetch all existing CSV-imported quiz events with null scorePercent
        const existingEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'quiz_attempted',
            source: 'csv_import'
        }, '-occurredAt', 10000);
        
        const eventsWithNullScore = existingEvents.filter(e => !Number.isFinite(e.scorePercent));
        console.log(`[REPAIR CSV] Found ${eventsWithNullScore.length} CSV-imported events with null scorePercent`);
        
        // Parse CSV
        const lines = csvText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (lines.length < 2) {
            return Response.json({ error: 'CSV must have at least 1 header + 1 data row' }, { status: 400 });
        }
        
        const headerLine = lines[0];
        const headers = parseCSVLine(headerLine);
        console.log(`[REPAIR CSV] Headers: ${JSON.stringify(headers)}`);
        
        // Find column indices
        const courseNameIdx = getColumn(headers, ['Course Name', 'Course']);
        const quizNameIdx = getColumn(headers, ['Survey/Quiz Name', 'Quiz Name', 'Quiz']);
        const studentEmailIdx = getColumn(headers, ['Student Email', 'Email']);
        const dateIdx = getColumn(headers, ['Date Completed (UTC)', 'Date Completed', 'Date', 'Completed At']);
        const scoreIdx = getColumn(headers, ['% Score', '% score', 'Percentage Score', 'Score %', 'Score']);
        
        if (quizNameIdx === -1 || studentEmailIdx === -1) {
            return Response.json({
                error: 'CSV missing required columns: Quiz Name and Student Email'
            }, { status: 400 });
        }
        
        const scoreDetected = scoreIdx !== -1;
        console.log(`[REPAIR CSV] Score column detected: ${scoreDetected}`);
        
        if (!scoreDetected) {
            return Response.json({
                error: 'CSV missing score column',
                scoreDetected: false
            }, { status: 400 });
        }
        
        // Parse all CSV rows first
        const csvRows = [];
        for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
            const line = lines[rowIdx];
            const fields = parseCSVLine(line);
            
            const quizName = fields[quizNameIdx]?.trim() || '';
            const studentEmail = fields[studentEmailIdx]?.trim().toLowerCase() || '';
            const courseName = courseNameIdx !== -1 ? fields[courseNameIdx]?.trim() || '' : '';
            const rawScore = scoreIdx !== -1 ? fields[scoreIdx]?.trim() || '' : '';
            const dateStr = dateIdx !== -1 ? fields[dateIdx]?.trim() || '' : '';
            
            if (!quizName || !studentEmail) continue;
            
            const scorePercent = parsePercent(rawScore);
            if (scorePercent === null) {
                console.log(`[REPAIR CSV] Parse error row ${rowIdx + 1}: ${quizName} / ${rawScore}`);
                continue;
            }
            
            csvRows.push({
                quizName,
                studentEmail,
                courseName,
                scorePercent,
                dateStr,
                rowIdx: rowIdx + 1
            });
        }
        
        console.log(`[REPAIR CSV] Parsed ${csvRows.length} valid CSV rows with scores`);
        
        // Group events and CSV rows by (studentEmail, quizName, courseName)
        const eventsByKey = {};
        eventsWithNullScore.forEach(e => {
            const key = `${e.studentEmail?.toLowerCase()}|${e.contentTitle?.toLowerCase()}|${e.courseName || ''}`;
            if (!eventsByKey[key]) eventsByKey[key] = [];
            eventsByKey[key].push(e);
        });
        
        // Match and update
        let matched = 0;
        let updated = 0;
        let ambiguousMatches = 0;
        const updates = [];
        
        for (const csvRow of csvRows) {
            const key = `${csvRow.studentEmail}|${csvRow.quizName.toLowerCase()}|${csvRow.courseName}`;
            const candidates = eventsByKey[key] || [];
            
            if (candidates.length === 0) continue;
            
            matched++;
            
            // If multiple candidates, match by date
            let targetEvent = candidates[0];
            if (candidates.length > 1) {
                ambiguousMatches++;
                
                if (csvRow.dateStr) {
                    try {
                        const csvDate = new Date(csvRow.dateStr);
                        let bestMatch = candidates[0];
                        let bestDiff = Math.abs(new Date(candidates[0].occurredAt).getTime() - csvDate.getTime());
                        
                        for (const candidate of candidates) {
                            const diff = Math.abs(new Date(candidate.occurredAt).getTime() - csvDate.getTime());
                            if (diff < bestDiff) {
                                bestDiff = diff;
                                bestMatch = candidate;
                            }
                        }
                        targetEvent = bestMatch;
                        console.log(`[REPAIR CSV] Matched ambiguous: ${csvRow.quizName} (${candidates.length} candidates, picked by date)`);
                    } catch (e) {
                        console.log(`[REPAIR CSV] Date parse failed: ${csvRow.dateStr}, using first candidate`);
                    }
                } else {
                    console.log(`[REPAIR CSV] Ambiguous match: ${csvRow.quizName} (${candidates.length} candidates, no date, using first)`);
                }
            }
            
            // Update
            await base44.asServiceRole.entities.ActivityEvent.update(targetEvent.id, {
                scorePercent: csvRow.scorePercent,
                metadata: {
                    ...(targetEvent.metadata || {}),
                    rawScore: csvRow.scorePercent.toString()
                }
            });
            
            updated++;
            updates.push({
                studentEmail: csvRow.studentEmail,
                quizName: csvRow.quizName,
                courseName: csvRow.courseName,
                scorePercent: csvRow.scorePercent,
                eventId: targetEvent.id
            });
            
            console.log(`[REPAIR CSV] Updated: ${csvRow.studentEmail} / ${csvRow.quizName} / ${csvRow.scorePercent}%`);
        }
        
        const stillMissing = eventsWithNullScore.length - updated;
        
        return Response.json({
            totalRowsInCsv: csvRows.length,
            eventsMatched: matched,
            eventsUpdated: updated,
            eventsStillMissing: stillMissing,
            ambiguousMatches: ambiguousMatches,
            updates: updates.slice(0, 15)
        }, { status: 200 });
    } catch (error) {
        console.error('[REPAIR CSV ERROR]', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});