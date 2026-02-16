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

        // Get all CSV-imported and rest_backfill quiz attempts (both sources need repair)
        const csvEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'quiz_attempted'
        }, null, 5000);

        const needsRepair = csvEvents.filter(e => 
            e.source === 'csv_import' || e.source === 'rest_backfill'
        );

        let repaired = 0;
        let skipped = 0;
        let errors = [];
        let deleted = 0;

        for (const event of needsRepair) {
            try {
                // Parse the raw CSV row from rawPayload
                const rawRow = JSON.parse(event.rawPayload || '{}');
                
                // Check if this event has corrupted data (occurredAt is not a valid ISO timestamp)
                const isDateCorrupted = !event.occurredAt || event.occurredAt.length < 10 || 
                                       !event.occurredAt.includes('T') || !event.occurredAt.includes('Z');
                
                if (isDateCorrupted) {
                    // Delete corrupted records
                    await base44.asServiceRole.entities.ActivityEvent.delete(event.id);
                    deleted++;
                    continue;
                }
                
                const rawPercentScore = rawRow['% Score'];
                
                if (!rawPercentScore) {
                    skipped++;
                    continue;
                }
                
                const correctScorePercent = parsePercentScore(rawPercentScore);
                
                // Check if the current scorePercent is suspiciously wrong
                // If it matches correctCount (indicating "Total Correct" was used), repair it
                const metadata = event.metadata || {};
                const correctCount = metadata.correctCount;
                const isWrong = (correctCount && event.scorePercent === correctCount);
                
                // Or if scorePercent is null/undefined
                const needsFix = 
                    event.scorePercent === null || 
                    event.scorePercent === undefined ||
                    isWrong;
                
                if (needsFix && correctScorePercent !== null) {
                    // Also fix metadata to have correct totalQuestions
                    const totalQuestions = rawRow['Total Number of Questions'] ? Number(rawRow['Total Number of Questions']) : null;
                    
                    await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                        scorePercent: correctScorePercent,
                        metadata: {
                            ...metadata,
                            totalQuestions: totalQuestions,
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
            totalProcessed: needsRepair.length,
            repaired,
            skipped,
            deleted,
            errors
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});