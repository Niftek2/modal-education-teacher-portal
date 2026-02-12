import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Fetch last 50 webhook events
        const webhookEvents = await base44.asServiceRole.entities.WebhookEvent.list('-created_date', 50);
        
        return Response.json({
            logs: webhookEvents
        }, { status: 200 });
    } catch (error) {
        console.error('[DEBUG] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});