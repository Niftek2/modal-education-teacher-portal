import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only: Repair existing CSV-imported quiz records
 * 
 * Finds all quiz_attempted events from CSV imports with missing scorePercent
 * and re-parses scores from metadata.rawScore, then updates attemptNumber deterministically.
 * 
 * Safe and idempotent: only updates records that need repair.
 */

/**
 * Parse percent value: "70%", "70", "0.7", "", etc.
 */
function parsePercent(value) {
    if (!value) return null;
    
    const str = String(value).trim();
    if (str === '' || str.toLowerCase() === 'n/a') return null;
    
    const hasPercent = str.endsWith('%');
    const numStr = str.replace('%', '').replace(/,/g, '').trim();
    
    const num = parseFloat(numStr);
    if (!Number.isFinite(num)) return null;
    
    let result = num;
    if (!hasPercent && num >= 0 && num <= 1) {
        result = num * 100;
    }
    
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
        
        // Fetch all CSV-imported quiz events
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-created_date', 5000);
        const csvQuizEvents = allEvents.filter(e => 
            e.eventType === 'quiz_attempted' && 
            e.source === 'csv_import'
        );
        
        console.log(`[REPAIR] Found ${csvQuizEvents.length} CSV quiz events`);
        
        // Group by (studentEmail, contentTitle, courseName) to compute attempt numbers
        const groupMap = {};
        csvQuizEvents.forEach(e => {
            const groupKey = `${e.studentEmail}|${e.contentTitle}|${e.courseName}`;
            if (!groupMap[groupKey]) {
                groupMap[groupKey] = [];
            }
            groupMap[groupKey].push(e);
        });
        
        // Sort each group by occurredAt
        Object.values(groupMap).forEach(group => {
            group.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
        });
        
        let repaired = 0;
        const repairs = [];
        
        // Update each event with correct attemptNumber and re-parse scorePercent
        for (const group of Object.values(groupMap)) {
            for (let idx = 0; idx < group.length; idx++) {
                const event = group[idx];
                const newAttemptNumber = idx + 1;
                
                // Check if needs repair
                const metadata = event.metadata || {};
                const currentAttemptNumber = metadata.attemptNumber;
                const currentScorePercent = event.scorePercent;
                
                // Try to re-parse score from metadata.rawScore if currently null
                let newScorePercent = currentScorePercent;
                if (newScorePercent === null && metadata.rawScore) {
                    newScorePercent = parsePercent(metadata.rawScore);
                    console.log(`[REPAIR] Re-parsed score for ${event.studentEmail} / ${event.contentTitle}: "${metadata.rawScore}" → ${newScorePercent}`);
                }
                
                const attemptNumberNeedsRepair = currentAttemptNumber !== newAttemptNumber;
                const scoreNeedsRepair = newScorePercent !== null && currentScorePercent === null;
                
                if (attemptNumberNeedsRepair || scoreNeedsRepair) {
                    // Repair the record
                    await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                        scorePercent: newScorePercent,
                        metadata: {
                            ...metadata,
                            attemptNumber: newAttemptNumber
                        }
                    });
                    
                    repaired++;
                    repairs.push({
                        id: event.id,
                        studentEmail: event.studentEmail,
                        quizName: event.contentTitle,
                        courseName: event.courseName,
                        oldAttemptNumber: currentAttemptNumber,
                        newAttemptNumber: newAttemptNumber,
                        oldScorePercent: currentScorePercent,
                        newScorePercent: newScorePercent,
                        rawScore: metadata.rawScore
                    });
                    
                    console.log(`[REPAIR] ${event.studentEmail} / ${event.contentTitle} / attempt ${newAttemptNumber} / score ${newScorePercent}`);
                }
            }
        }
        
        console.log(`[REPAIR] Completed: ${repaired} events repaired`);
        
        return Response.json({
            scanned: csvQuizEvents.length,
            repaired,
            repairs: repairs.slice(0, 50)
        }, { status: 200 });
    } catch (error) {
        console.error('[REPAIR QUIZ SCORES] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});