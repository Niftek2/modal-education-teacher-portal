import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Admin function to ensure Weston's webhook data appears for teacher Nadia
 */

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const westonEmail = 'weston@modalmath.com';
        const nadiaEmail = 'nadia.todhh@gmail.com';

        // Get all webhook events for Weston
        const westonEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            source: 'webhook'
        }, null, 5000);

        // Filter to events that might be Weston's (check various email fields in rawPayload)
        const westonWebhookEvents = westonEvents.filter(e => {
            if (e.studentEmail?.toLowerCase() === westonEmail.toLowerCase()) return true;
            
            try {
                const payload = JSON.parse(e.rawPayload || '{}');
                const email = payload.user?.email || payload.email || '';
                return email.toLowerCase() === westonEmail.toLowerCase();
            } catch {
                return false;
            }
        });

        // Update any that don't have correct studentEmail
        let updated = 0;
        for (const event of westonWebhookEvents) {
            if (event.studentEmail?.toLowerCase() !== westonEmail.toLowerCase()) {
                await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                    studentEmail: westonEmail.toLowerCase()
                });
                updated++;
            }
        }

        return Response.json({
            success: true,
            westonEmail,
            nadiaEmail,
            totalWebhookEvents: westonWebhookEvents.length,
            updatedEvents: updated,
            message: `Found ${westonWebhookEvents.length} webhook events for Weston, updated ${updated} to ensure proper email`
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});