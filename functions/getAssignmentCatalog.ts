import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // No authentication required - catalog is public
        
        // Get active catalog items (limit 1000 to get all PK-L5 lessons)
        const catalog = await base44.asServiceRole.entities.AssignmentCatalog.filter({ 
            isActive: true 
        }, null, 1000);

        const LEVEL_ORDER = ['PK', 'K', 'L1', 'L2', 'L3', 'L4', 'L5'];

        const sorted = (catalog || []).sort((a, b) => {
            const levelA = LEVEL_ORDER.indexOf(a.level);
            const levelB = LEVEL_ORDER.indexOf(b.level);
            if (levelA !== levelB) return levelA - levelB;

            const topicA = (a.topic || '').toLowerCase();
            const topicB = (b.topic || '').toLowerCase();
            if (topicA !== topicB) return topicA.localeCompare(topicB);

            const cleanTitle = (t) => t.replace(/Part\s*\d+/gi, '').trim().toLowerCase();
            const titleA = cleanTitle(a.title || '');
            const titleB = cleanTitle(b.title || '');
            if (titleA !== titleB) return titleA.localeCompare(titleB);

            return (a.title || '').localeCompare(b.title || '');
        });

        const cleanedCatalog = sorted.map(item => ({
            ...item,
            displayTitle: item.title.replace(/Part\s*\d+/gi, '').trim()
        }));

        return Response.json({ success: true, catalog: cleanedCatalog });

    } catch (error) {
        console.error('Get catalog error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});