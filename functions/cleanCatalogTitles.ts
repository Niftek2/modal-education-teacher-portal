import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Strip "- Part N", "- Item N", "Part N", "Item N" from end of title
function cleanTitle(raw) {
    return raw
        .replace(/\s*-\s*(Part|Item)\s*\d+\s*$/gi, '')
        .replace(/\s*(Part|Item)\s*\d+\s*$/gi, '')
        .trim();
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Fetch all catalog records (paginate if needed)
        const all = await base44.asServiceRole.entities.AssignmentCatalog.list();

        let updated = 0;
        let skipped = 0;

        for (const record of all || []) {
            const original = record.title || '';
            const cleaned = cleanTitle(original);

            // Also derive topic from the original title if not set
            // e.g. "Money (United States) - Item 2" → topic = "Money (United States)"
            let topic = record.topic;
            if (!topic) {
                const match = original.match(/^(.+?)\s*-\s*(Part|Item)\s*\d+/i);
                topic = match ? match[1].trim() : cleaned;
            }

            if (cleaned !== original || (topic && topic !== record.topic)) {
                await base44.asServiceRole.entities.AssignmentCatalog.update(record.id, {
                    title: cleaned,
                    topic: topic
                });
                console.log(`Updated: "${original}" → "${cleaned}" (topic: "${topic}")`);
                updated++;
            } else {
                skipped++;
            }
        }

        return Response.json({
            success: true,
            total: all.length,
            updated,
            skipped,
            message: `Cleaned ${updated} records, ${skipped} already clean`
        });

    } catch (error) {
        console.error('Clean catalog titles error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});