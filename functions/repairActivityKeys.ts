import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list(null, 500);
        let scanned = 0;
        let repaired = 0;
        const repairs = [];

        for (const event of allEvents) {
            scanned++;
            let updated = false;
            const updates = {};

            // Backfill thinkificUserId from metadata.userId
            if (!event.thinkificUserId && event.metadata?.userId) {
                updates.thinkificUserId = Number(event.metadata.userId);
                updated = true;
            }

            // Normalize stored email (lowercase + trim)
            if (event.studentEmail) {
                const normalized = event.studentEmail.trim().toLowerCase();
                if (normalized !== event.studentEmail) {
                    updates.studentEmail = normalized;
                    updated = true;
                }
            }

            if (updated) {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, updates);
                repaired++;
                repairs.push({
                    id: event.id,
                    studentEmail: updates.studentEmail || event.studentEmail,
                    thinkificUserId: updates.thinkificUserId || event.thinkificUserId
                });
            }
        }

        return Response.json({
            scanned,
            repaired,
            sampleRepairs: repairs.slice(0, 10)
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});