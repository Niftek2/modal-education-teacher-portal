import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // No authentication required - catalog is public
        
        // Get active catalog items (limit 1000 to get all PK-L5 lessons)
        const catalog = await base44.asServiceRole.entities.AssignmentCatalog.filter({ 
            isActive: true 
        }, null, 1000);

        // Sort by level then title
        const sorted = (catalog || []).sort((a, b) => {
            if (a.level !== b.level) return a.level.localeCompare(b.level);
            return a.title.localeCompare(b.title);
        });

        return Response.json({
            success: true,
            catalog: sorted
        });

    } catch (error) {
        console.error('Get catalog error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});