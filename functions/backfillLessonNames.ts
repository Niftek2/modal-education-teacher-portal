import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Backfill missing lesson names from raw payloads
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        console.log('[BACKFILL] Starting lesson name backfill...');

        // Fetch all lesson_completed events with null or missing lessonName
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({
            eventType: 'lesson_completed'
        });

        // Filter to only those with missing lessonName
        const missingName = events.filter(e => !e.lessonName || e.lessonName === 'Unknown Lesson');

        console.log(`[BACKFILL] Found ${missingName.length} lessons with missing names`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const event of missingName) {
            try {
                if (!event.rawPayload) {
                    console.log(`[BACKFILL] Skipping ${event.id}: no rawPayload`);
                    skipped++;
                    continue;
                }

                // Parse raw payload
                const rawData = JSON.parse(event.rawPayload);
                
                // Handle both formats: direct payload or wrapper with payload property
                const payload = rawData.payload || rawData;

                // Extract lesson name
                const lessonName = payload.lesson?.name;

                if (!lessonName) {
                    console.log(`[BACKFILL] Skipping ${event.id}: no lesson name in payload`);
                    skipped++;
                    continue;
                }

                // Update the record
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    lessonName: lessonName
                });
                
                console.log(`[BACKFILL] ✓ Updated ${event.id}: ${lessonName}`);
                updated++;

            } catch (error) {
                console.error(`[BACKFILL] Error updating ${event.id}:`, error.message);
                errors++;
            }
        }

        const summary = {
            total: missingName.length,
            updated,
            skipped,
            errors,
            message: `Backfill complete: ${updated} updated, ${skipped} skipped, ${errors} errors`
        };

        console.log('[BACKFILL] Summary:', summary);
        return Response.json(summary, { status: 200 });

    } catch (error) {
        console.error('[BACKFILL] Fatal error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});