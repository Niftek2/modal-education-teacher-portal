import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }
        
        const body = await req.json();
        const { rows } = body; // Array of { eventType, studentEmail, courseName, contentTitle, score, maxScore, occurredAt }
        
        if (!Array.isArray(rows) || rows.length === 0) {
            return Response.json({ error: 'Invalid or empty rows' }, { status: 400 });
        }
        
        let imported = 0;
        let duplicates = 0;
        let errors = 0;
        const errorDetails = [];
        
        for (const row of rows) {
            try {
                const { eventType, studentEmail, courseName, contentTitle, score, maxScore, occurredAt } = row;
                
                if (!eventType || !studentEmail || !occurredAt) {
                    errors++;
                    errorDetails.push(`Row missing required fields: ${JSON.stringify(row)}`);
                    continue;
                }
                
                // Create dedupeKey (use occurredAt and email as stable identifier)
                const dedupeKey = await createDedupeKey(eventType, studentEmail, contentTitle, courseName, occurredAt);
                
                // Check if already exists
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existing.length > 0) {
                    duplicates++;
                    continue;
                }
                
                // Create activity event
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentEmail,
                    studentUserId: studentEmail,
                    studentDisplayName: studentEmail,
                    eventType,
                    courseName: courseName || '',
                    courseId: '',
                    contentTitle: contentTitle || '',
                    contentId: '',
                    occurredAt,
                    source: 'rest_backfill',
                    rawEventId: dedupeKey,
                    rawPayload: JSON.stringify(row),
                    dedupeKey,
                    metadata: score !== undefined && maxScore !== undefined ? {
                        score,
                        maxScore,
                        percentage: Math.round((score / maxScore) * 100)
                    } : {}
                });
                
                imported++;
            } catch (error) {
                errors++;
                errorDetails.push(`Error processing row: ${error.message}`);
                console.error('[CSV IMPORT] Row error:', error);
            }
        }
        
        return Response.json({
            success: true,
            imported,
            duplicates,
            errors,
            errorDetails: errors > 0 ? errorDetails.slice(0, 5) : []
        }, { status: 200 });
        
    } catch (error) {
        console.error('[CSV IMPORT] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});