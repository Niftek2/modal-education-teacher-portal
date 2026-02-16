import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);

        // Find all quiz attempts
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const quizEvents = allEvents.filter(e => 
            e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted'
        );

        // Group by resultId to find duplicates
        const byResultId = {};
        for (const event of quizEvents) {
            let metadata = event.metadata || {};
            if (typeof metadata === 'string') {
                try {
                    metadata = JSON.parse(metadata);
                } catch {
                    metadata = {};
                }
            }
            
            const resultId = metadata.resultId;
            if (!resultId) continue;
            
            if (!byResultId[resultId]) {
                byResultId[resultId] = [];
            }
            byResultId[resultId].push(event);
        }

        // Find duplicates and keep the one with scorePercent
        const toDelete = [];
        const duplicateGroups = [];

        for (const [resultId, events] of Object.entries(byResultId)) {
            if (events.length > 1) {
                // Sort by: has scorePercent first, then by created_date
                events.sort((a, b) => {
                    const aHasScore = a.metadata?.scorePercent != null;
                    const bHasScore = b.metadata?.scorePercent != null;
                    if (aHasScore && !bHasScore) return -1;
                    if (!aHasScore && bHasScore) return 1;
                    return new Date(a.created_date) - new Date(b.created_date);
                });

                const keep = events[0];
                const deleteList = events.slice(1);
                
                duplicateGroups.push({
                    resultId,
                    keep: { id: keep.id, scorePercent: keep.metadata?.scorePercent, eventType: keep.eventType },
                    delete: deleteList.map(e => ({ id: e.id, scorePercent: e.metadata?.scorePercent, eventType: e.eventType }))
                });

                toDelete.push(...deleteList.map(e => e.id));
            }
        }

        // Delete the duplicates
        for (const id of toDelete) {
            await base44.asServiceRole.entities.ActivityEvent.delete(id);
        }

        return Response.json({
            success: true,
            duplicateGroupsFound: duplicateGroups.length,
            eventsDeleted: toDelete.length,
            details: duplicateGroups
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});