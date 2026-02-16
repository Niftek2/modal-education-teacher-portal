import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only: Import historical activity from CSV (additive only, never overwrites webhooks)
 * 
 * Required CSV columns: thinkificUserId, eventType, occurredAt
 * Optional CSV columns: studentEmail, contentTitle, courseId, courseName, % Score
 * 
 * eventType: quiz_attempted | lesson_completed | enrollment_progress
 * occurredAt: ISO 8601 timestamp
 * 
 * Deduplicates on (studentEmail + eventType + contentTitle + occurredAt) hash
 * Creates ActivityEvent with source='csv' only, never updates/deletes webhook data
 */

async function createDedupeKey(studentEmail, eventType, contentTitle, occurredAt) {
    const data = `${studentEmail}-${eventType}-${contentTitle}-${occurredAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
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
        
        const thinkificUserIdIdx = header.indexOf('thinkificUserId');
        const emailIdx = header.indexOf('studentEmail'); // Optional fallback
        const typeIdx = header.indexOf('eventType');
        const titleIdx = header.indexOf('contentTitle');
        const courseIdIdx = header.indexOf('courseId');
        const courseNameIdx = header.indexOf('courseName');
        const occurredIdx = header.indexOf('occurredAt');
        const scoreIdx = header.indexOf('% Score') !== -1 ? header.indexOf('% Score')
            : header.indexOf('score') !== -1 ? header.indexOf('score')
            : header.indexOf('Score') !== -1 ? header.indexOf('Score')
            : -1;
        const maxScoreIdx = header.indexOf('maxScore');
        
        if (thinkificUserIdIdx === -1 || typeIdx === -1 || occurredIdx === -1) {
            return Response.json({ 
                error: 'CSV must have: thinkificUserId, eventType, occurredAt' 
            }, { status: 400 });
        }
        
        let imported = 0;
        let skipped = 0;
        let unlinked = 0;
        const errors = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                const fields = parseCSVLine(line);
                let thinkificUserId = fields[thinkificUserIdIdx] ? parseInt(fields[thinkificUserIdIdx], 10) : null;
                const studentEmailRaw = emailIdx !== -1 ? fields[emailIdx] : '';
                const eventType = fields[typeIdx];
                const contentTitle = fields[titleIdx] || '';
                const courseId = fields[courseIdIdx] || '';
                const courseName = fields[courseNameIdx] || '';
                const occurredAt = fields[occurredIdx];
                
                if (!eventType || !occurredAt) {
                    errors.push(`Row ${i + 1}: missing required field`);
                    continue;
                }
                
                let studentEmail = studentEmailRaw ? studentEmailRaw.toLowerCase().trim() : '';
                let studentDisplayName = '';
                
                // If thinkificUserId not provided, try resolving via StudentProfile by email
                if (!thinkificUserId && studentEmail) {
                    const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ email: studentEmail });
                    if (profiles.length > 0) {
                        thinkificUserId = profiles[0].thinkificUserId;
                        studentDisplayName = profiles[0].displayName || '';
                    }
                } else if (thinkificUserId) {
                    // Enrich from StudentProfile if thinkificUserId provided
                    const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ thinkificUserId });
                    if (profiles.length > 0) {
                        studentDisplayName = profiles[0].displayName || '';
                        if (!studentEmail) {
                            studentEmail = profiles[0].email || '';
                        }
                    }
                }
                
                // If thinkificUserId still not resolved, mark as UNLINKED and skip
                if (!thinkificUserId) {
                    errors.push(`Row ${i + 1}: UNLINKED - could not resolve thinkificUserId for "${studentEmailRaw}"`);
                    unlinked++;
                    continue; // Do NOT create ActivityEvent
                }
                
                const dedupeKey = await createDedupeKey(studentEmail, eventType, contentTitle, occurredAt);
                
                // Check if exists (prevents duplicate CSV rows on reupload)
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existing.length > 0) {
                    skipped++;
                    continue;
                }
                
                // Parse score percent from CSV
                const scorePercent = (scoreIdx !== -1 && fields[scoreIdx] !== '')
                    ? Number(String(fields[scoreIdx]).replace('%', '').trim())
                    : null;
                
                // Create activity event (CSV is additive only, never updates/deletes)
                const metadata = {};
                if (maxScoreIdx !== -1 && fields[maxScoreIdx]) {
                    metadata.maxScore = parseFloat(fields[maxScoreIdx]);
                }
                
                await base44.asServiceRole.entities.ActivityEvent.create({
                    thinkificUserId: thinkificUserId,
                    studentUserId: String(thinkificUserId),
                    studentEmail: studentEmail,
                    studentDisplayName: studentDisplayName || studentEmail || 'Unknown',
                    courseId: courseId,
                    courseName: courseName,
                    eventType: eventType,
                    contentId: '',
                    contentTitle: contentTitle,
                    occurredAt: occurredAt,
                    source: 'csv',
                    rawEventId: '',
                    rawPayload: JSON.stringify({ line }),
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
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
            unlinked,
            total: lines.length - 1,
            errors: errors.slice(0, 20)
        }, { status: 200 });
    } catch (error) {
        console.error('[CSV IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});