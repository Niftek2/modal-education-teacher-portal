import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

async function createCSVDedupeKey(thinkificUserId, eventType, occurredAt, courseId, lessonId, attemptNumber) {
    const data = `csv:${thinkificUserId}-${eventType}-${occurredAt}-${courseId || ''}-${lessonId || ''}-${attemptNumber || ''}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return 'csv:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function checkWebhookDuplicate(base44, thinkificUserId, eventType, lessonId, quizId, occurredAt) {
    const tolerance = 5 * 60 * 1000;
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
            if (eventType === 'quiz.attempted' && event.lessonId === quizId) {
                return true;
            }
        }
    }
    
    return false;
}

function parseThinkificDate(dateStr) {
    // "February 12, 2026 21:16" -> ISO
    const date = new Date(dateStr);
    return date.toISOString();
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        
        // Fetch CSV from URL
        const csvUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/61e7822e2_Weston_responses_2026-02-16_19_06.csv';
        const csvResponse = await fetch(csvUrl);
        const csvText = await csvResponse.text();
        
        const lines = csvText.trim().split('\n');
        const header = lines[0].split(',');
        
        // Get Weston's profile
        const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ 
            email: 'weston@modalmath.com' 
        });
        
        if (!profiles || profiles.length === 0) {
            return Response.json({ error: 'Weston not found in StudentProfile' }, { status: 404 });
        }
        
        const thinkificUserId = profiles[0].thinkificUserId;
        const studentEmail = 'weston@modalmath.com';
        const studentDisplayName = profiles[0].displayName || 'Weston R';
        
        let added = 0;
        let skippedDuplicates = 0;
        let skippedAsWebhookDuplicate = 0;
        const errors = [];
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            try {
                const fields = line.split(',');
                
                const courseName = fields[0]?.trim();
                const quizName = fields[1]?.trim();
                const dateCompleted = fields[4]?.trim();
                const totalCorrect = parseInt(fields[6]?.trim(), 10);
                const scorePercent = parseInt(fields[7]?.trim(), 10);
                const totalQuestions = parseInt(fields[5]?.trim(), 10);
                
                if (!dateCompleted || !quizName) continue;
                
                const occurredAt = parseThinkificDate(dateCompleted);
                const incorrectCount = totalQuestions - totalCorrect;
                
                // Create dedupeKey
                const dedupeKey = await createCSVDedupeKey(
                    thinkificUserId, 
                    'quiz.attempted', 
                    occurredAt, 
                    courseName, 
                    quizName, 
                    1
                );
                
                // Check CSV duplicate
                const existingCSV = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existingCSV.length > 0) {
                    skippedDuplicates++;
                    continue;
                }
                
                // Check webhook duplicate
                const isWebhookDupe = await checkWebhookDuplicate(
                    base44, 
                    thinkificUserId, 
                    'quiz.attempted', 
                    null, 
                    quizName, 
                    occurredAt
                );
                if (isWebhookDupe) {
                    skippedAsWebhookDuplicate++;
                    continue;
                }
                
                // Create activity event
                await base44.asServiceRole.entities.ActivityEvent.create({
                    thinkificUserId,
                    source: 'csv',
                    eventType: 'quiz.attempted',
                    occurredAt,
                    dedupeKey,
                    courseName,
                    lessonName: quizName,
                    grade: scorePercent,
                    correctCount: totalCorrect,
                    incorrectCount,
                    studentEmail,
                    studentDisplayName,
                    rawPayload: JSON.stringify({ 
                        csvRow: line,
                        courseName,
                        quizName,
                        scorePercent 
                    })
                });
                
                added++;
            } catch (err) {
                errors.push(`Row ${i + 1}: ${err.message}`);
            }
        }
        
        return Response.json({
            success: true,
            student: 'Weston R',
            added,
            skippedDuplicates,
            skippedAsWebhookDuplicate,
            total: lines.length - 1,
            errors: errors.slice(0, 20)
        }, { status: 200 });
    } catch (error) {
        console.error('[WESTON IMPORT] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});