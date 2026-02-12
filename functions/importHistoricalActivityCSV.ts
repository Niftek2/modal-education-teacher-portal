import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only: Import historical activity from CSV
 * 
 * CSV columns: studentEmail, eventType, contentTitle, courseId, courseName, occurredAt, score, maxScore
 * 
 * eventType: quiz_attempted | lesson_completed | enrollment_progress
 * occurredAt: ISO 8601 timestamp
 * 
 * Deduplicates on (studentEmail + eventType + contentTitle + occurredAt) hash
 */

async function createDedupeKey(studentEmail, eventType, contentTitle, occurredAt) {
    const data = `${studentEmail}-${eventType}-${contentTitle}-${occurredAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

function parseCSVLine(line) {
    // Simple CSV parse (handle quoted fields)
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

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Only nadia.todhh@gmail.com can use CSV import
        if (user?.email?.toLowerCase() !== 'nadia.todhh@gmail.com') {
            return Response.json({ error: 'Forbidden: CSV import access denied' }, { status: 403 });
        }
        
        const body = await req.json();
        const { csvText } = body;
        
        if (!csvText || !csvText.trim()) {
            return Response.json({ error: 'CSV text required' }, { status: 400 });
        }
        
        const lines = csvText.trim().split('\n');
        const header = parseCSVLine(lines[0]);
        
        // Expected: studentEmail, eventType, contentTitle, courseId, courseName, occurredAt, [score, maxScore]
        const emailIdx = header.indexOf('studentEmail');
        const typeIdx = header.indexOf('eventType');
        const titleIdx = header.indexOf('contentTitle');
        const courseIdIdx = header.indexOf('courseId');
        const courseNameIdx = header.indexOf('courseName');
        const occurredIdx = header.indexOf('occurredAt');
        const scoreIdx = header.indexOf('score');
        const maxScoreIdx = header.indexOf('maxScore');
        
        if (emailIdx === -1 || typeIdx === -1 || occurredIdx === -1) {
            return Response.json({ 
                error: 'CSV must have: studentEmail, eventType, occurredAt' 
            }, { status: 400 });
        }
        
        let imported = 0;
        let skipped = 0;
        const errors = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                const fields = parseCSVLine(line);
                const studentEmail = fields[emailIdx];
                const eventType = fields[typeIdx];
                const contentTitle = fields[titleIdx] || '';
                const courseId = fields[courseIdIdx] || '';
                const courseName = fields[courseNameIdx] || '';
                const occurredAt = fields[occurredIdx];
                
                if (!studentEmail || !eventType || !occurredAt) {
                    errors.push(`Row ${i + 1}: missing required field`);
                    continue;
                }
                
                if (!studentEmail.toLowerCase().endsWith('@modalmath.com')) {
                    errors.push(`Row ${i + 1}: student email must end with @modalmath.com`);
                    continue;
                }
                
                const dedupeKey = await createDedupeKey(studentEmail, eventType, contentTitle, occurredAt);
                
                // Check if exists
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existing.length > 0) {
                    skipped++;
                    continue;
                }
                
                // Create activity event
                const metadata = {};
                if (scoreIdx !== -1 && fields[scoreIdx]) {
                    metadata.score = parseFloat(fields[scoreIdx]);
                }
                if (maxScoreIdx !== -1 && fields[maxScoreIdx]) {
                    metadata.maxScore = parseFloat(fields[maxScoreIdx]);
                }
                
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: '', // Not always available from CSV
                    studentEmail: studentEmail,
                    studentDisplayName: studentEmail.split('@')[0],
                    courseId: courseId,
                    courseName: courseName,
                    eventType: eventType,
                    contentId: '',
                    contentTitle: contentTitle,
                    occurredAt: occurredAt,
                    source: 'csv_import',
                    rawEventId: '',
                    rawPayload: JSON.stringify({ line }),
                    dedupeKey: dedupeKey,
                    metadata: metadata
                });
                
                imported++;
            } catch (err) {
                errors.push(`Row ${i + 1}: ${err.message}`);
            }
        }
        
        return Response.json({
            imported,
            skipped,
            total: lines.length - 1,
            errors: errors.slice(0, 20) // First 20 errors
        }, { status: 200 });
    } catch (error) {
        console.error('[CSV IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});