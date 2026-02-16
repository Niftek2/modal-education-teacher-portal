import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * PRODUCTION LOCKED: CSV import for historical/missing student activity
 * Rules:
 * - CSV is additive only, never overwrites webhook data
 * - Uses csv:{hash} dedupeKey format
 * - Checks for webhook duplicates and skips them
 * - Returns detailed counts
 */

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

async function createCSVDedupeKey(thinkificUserId, eventType, occurredAt, courseId, lessonId, attemptNumber) {
    const data = `csv:${thinkificUserId}-${eventType}-${occurredAt}-${courseId || ''}-${lessonId || ''}-${attemptNumber || ''}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return 'csv:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function checkWebhookDuplicate(base44, thinkificUserId, eventType, lessonId, quizId, occurredAt) {
    // Check if a webhook event exists for the same student, eventType, content, within 5 minutes
    const tolerance = 5 * 60 * 1000; // 5 minutes in ms
    const occurredDate = new Date(occurredAt);
    const minDate = new Date(occurredDate.getTime() - tolerance).toISOString();
    const maxDate = new Date(occurredDate.getTime() + tolerance).toISOString();
    
    const webhookEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
        thinkificUserId,
        eventType,
        source: 'webhook'
    });
    
    for (const event of webhookEvents) {
        const eventDate = new Date(event.occurredAt);
        if (eventDate >= new Date(minDate) && eventDate <= new Date(maxDate)) {
            // Check content match
            if (eventType === 'lesson.completed' && event.lessonId === lessonId) {
                return true;
            }
            if (eventType === 'quiz.attempted' && event.lessonId === quizId) {
                return true;
            }
        }
    }
    
    return false;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Only nadia.todhh@gmail.com can import CSV
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
        
        // Required columns
        const userIdIdx = header.indexOf('thinkificUserId');
        const eventTypeIdx = header.indexOf('eventType');
        const occurredIdx = header.indexOf('occurredAt');
        
        // Optional columns
        const emailIdx = header.indexOf('studentEmail');
        const courseIdIdx = header.indexOf('courseId');
        const courseNameIdx = header.indexOf('courseName');
        const lessonIdIdx = header.indexOf('lessonId');
        const lessonNameIdx = header.indexOf('lessonName');
        const attemptIdx = header.indexOf('attemptNumber');
        const gradeIdx = header.indexOf('grade');
        const correctIdx = header.indexOf('correctCount');
        const incorrectIdx = header.indexOf('incorrectCount');
        
        if (userIdIdx === -1 || eventTypeIdx === -1 || occurredIdx === -1) {
            return Response.json({ 
                error: 'CSV must have: thinkificUserId, eventType, occurredAt' 
            }, { status: 400 });
        }
        
        let added = 0;
        let skippedDuplicates = 0;
        let skippedAsWebhookDuplicate = 0;
        const errors = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                const fields = parseCSVLine(line);
                
                const thinkificUserId = parseInt(fields[userIdIdx], 10);
                const eventType = fields[eventTypeIdx];
                const occurredAt = fields[occurredIdx];
                
                if (!thinkificUserId || !eventType || !occurredAt) {
                    errors.push(`Row ${i + 1}: missing required field`);
                    continue;
                }
                
                // Enrich from StudentProfile if available
                const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ thinkificUserId });
                const studentEmail = emailIdx !== -1 && fields[emailIdx] ? fields[emailIdx].toLowerCase().trim() 
                    : profiles[0]?.email || '';
                const studentDisplayName = profiles[0]?.displayName || studentEmail || 'Unknown';
                
                const courseId = courseIdIdx !== -1 && fields[courseIdIdx] ? parseInt(fields[courseIdIdx], 10) : null;
                const courseName = courseNameIdx !== -1 ? fields[courseNameIdx] : null;
                const lessonId = lessonIdIdx !== -1 && fields[lessonIdIdx] ? parseInt(fields[lessonIdIdx], 10) : null;
                const lessonName = lessonNameIdx !== -1 ? fields[lessonNameIdx] : null;
                const attemptNumber = attemptIdx !== -1 && fields[attemptIdx] ? parseInt(fields[attemptIdx], 10) : null;
                const grade = gradeIdx !== -1 && fields[gradeIdx] ? parseFloat(fields[gradeIdx]) : null;
                const correctCount = correctIdx !== -1 && fields[correctIdx] ? parseInt(fields[correctIdx], 10) : null;
                const incorrectCount = incorrectIdx !== -1 && fields[incorrectIdx] ? parseInt(fields[incorrectIdx], 10) : null;
                
                // Create CSV dedupeKey
                const dedupeKey = await createCSVDedupeKey(thinkificUserId, eventType, occurredAt, courseId, lessonId, attemptNumber);
                
                // Check CSV duplicate
                const existingCSV = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existingCSV.length > 0) {
                    skippedDuplicates++;
                    continue;
                }
                
                // Check webhook duplicate (meaning-level)
                const isWebhookDupe = await checkWebhookDuplicate(base44, thinkificUserId, eventType, lessonId, lessonId, occurredAt);
                if (isWebhookDupe) {
                    skippedAsWebhookDuplicate++;
                    continue;
                }
                
                // Create activity event
                const activity = {
                    thinkificUserId,
                    source: 'csv',
                    eventType,
                    occurredAt,
                    dedupeKey,
                    courseId,
                    courseName,
                    lessonId,
                    lessonName,
                    attemptNumber,
                    grade,
                    correctCount,
                    incorrectCount,
                    studentEmail,
                    studentDisplayName,
                    rawPayload: JSON.stringify({ csvRow: line })
                };
                
                await base44.asServiceRole.entities.ActivityEvent.create(activity);
                added++;
            } catch (err) {
                errors.push(`Row ${i + 1}: ${err.message}`);
            }
        }
        
        return Response.json({
            added,
            skippedDuplicates,
            skippedAsWebhookDuplicate,
            total: lines.length - 1,
            errors: errors.slice(0, 20)
        }, { status: 200 });
    } catch (error) {
        console.error('[CSV IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});