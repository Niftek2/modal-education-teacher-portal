import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const limit = body.limit || 50;
        
        const base44 = createClientFromRequest(req);
        
        // Fetch recent activity events
        const events = await base44.asServiceRole.entities.ActivityEvent.list('-created_date', limit);
        
        return Response.json({
            events: events
        }, { status: 200 });
    } catch (error) {
        console.error('[ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});