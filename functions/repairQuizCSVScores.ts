import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin-only: Repair existing CSV-imported quiz records
 * 
 * Finds all quiz_attempted events from CSV imports with missing scorePercent
 * and recomputes attemptNumber deterministically.
 * 
 * Safe and idempotent: only updates records that need repair.
 */

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
        
        // Update each event with correct attemptNumber
        for (const group of Object.values(groupMap)) {
            for (let idx = 0; idx < group.length; idx++) {
                const event = group[idx];
                const newAttemptNumber = idx + 1;
                
                // Check if needs repair
                const metadata = event.metadata || {};
                const currentAttemptNumber = metadata.attemptNumber;
                
                if (currentAttemptNumber !== newAttemptNumber) {
                    // Repair the record
                    const updated = await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
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
                        scorePercent: event.scorePercent
                    });
                    
                    console.log(`[REPAIR] ${event.studentEmail} / ${event.contentTitle} / attempt ${newAttemptNumber}`);
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