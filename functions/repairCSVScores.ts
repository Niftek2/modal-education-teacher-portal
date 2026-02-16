import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * One-time repair function to fix scorePercent values for CSV-imported quiz attempts
 * that were incorrectly parsed (e.g., using Total Correct instead of % Score)
 */

function parsePercentScore(value) {
    if (value === null || value === undefined || value === '') return null;
    
    let stringVal = String(value).trim();
    
    // Handle "NA" or similar
    if (stringVal.toLowerCase() === 'na' || stringVal.toLowerCase() === 'n/a') return null;
    
    // Remove % sign if present
    stringVal = stringVal.replace('%', '');
    
    const num = Number(stringVal);
    if (Number.isNaN(num)) return null;
    
    // If value is between 0 and 1, treat as decimal (0.7 = 70%)
    if (num > 0 && num < 1) {
        return num * 100;
    }
    
    // If value is between 1 and 100, treat as percentage
    if (num >= 0 && num <= 100) {
        return num;
    }
    
    // Invalid range
    return null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        // Get all CSV-imported quiz attempts
        const csvEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            source: 'csv_import',
            eventType: 'quiz_attempted'
        }, null, 5000);

        let repaired = 0;
        let skipped = 0;
        let errors = [];

        for (const event of csvEvents) {
            try {
                // Parse the raw CSV row from rawPayload
                const rawRow = JSON.parse(event.rawPayload || '{}');
                const rawPercentScore = rawRow['% Score'];
                
                if (!rawPercentScore) {
                    skipped++;
                    continue;
                }
                
                const correctScorePercent = parsePercentScore(rawPercentScore);
                
                // Check if the current scorePercent is wrong
                // If it's suspiciously low (like 6 when it should be 86), or null, repair it
                const needsRepair = 
                    event.scorePercent === null || 
                    event.scorePercent === undefined ||
                    (event.scorePercent < 50 && correctScorePercent > 50);
                
                if (needsRepair && correctScorePercent !== null) {
                    await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                        scorePercent: correctScorePercent,
                        metadata: {
                            ...event.metadata,
                            rawPercentScore: rawPercentScore,
                            repairedAt: new Date().toISOString(),
                            previousScore: event.scorePercent
                        }
                    });
                    repaired++;
                } else {
                    skipped++;
                }
            } catch (error) {
                errors.push({
                    eventId: event.id,
                    reason: error.message
                });
            }
        }

        return Response.json({
            success: true,
            totalProcessed: csvEvents.length,
            repaired,
            skipped,
            errors
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});