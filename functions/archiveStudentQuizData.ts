import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin function to archive (soft delete) csv_import quiz_attempted events for a specific student
 * Returns backup JSON first, then marks events as archived
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { studentEmail, executeArchive } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail is required' }, { status: 400 });
        }

        const normalizedEmail = studentEmail.trim().toLowerCase();

        // Fetch all csv_import quiz attempts for this student
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({
            studentEmail: normalizedEmail,
            eventType: 'quiz_attempted',
            source: 'csv_import'
        }, null, 5000);

        // Create backup JSON
        const backup = {
            studentEmail: normalizedEmail,
            archivedAt: new Date().toISOString(),
            totalEvents: events.length,
            events: events.map(e => ({
                id: e.id,
                contentTitle: e.contentTitle,
                courseName: e.courseName,
                occurredAt: e.occurredAt,
                scorePercent: e.scorePercent,
                dedupeKey: e.dedupeKey,
                rawPayload: e.rawPayload,
                metadata: e.metadata,
                created_date: e.created_date
            }))
        };

        // If executeArchive is true, perform the archive (add archived flag to metadata)
        if (executeArchive === true) {
            let archived = 0;
            for (const event of events) {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    metadata: {
                        ...event.metadata,
                        archived: true,
                        archivedAt: new Date().toISOString(),
                        archivedReason: 'csv_import_correction_needed'
                    }
                });
                archived++;
            }

            return Response.json({
                success: true,
                studentEmail: normalizedEmail,
                archived,
                backup
            });
        }

        // Otherwise just return the backup preview
        return Response.json({
            success: true,
            studentEmail: normalizedEmail,
            previewMode: true,
            totalEventsToArchive: events.length,
            backup,
            message: 'Call again with executeArchive=true to perform the archive'
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});