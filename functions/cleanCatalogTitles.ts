import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Strip "- Part N", "- Item N", "Part N", "Item N" from end of title
function cleanTitle(raw) {
    return raw
        .replace(/\s*-\s*(Part|Item)\s*\d+\s*$/gi, '')
        .replace(/\s*(Part|Item)\s*\d+\s*$/gi, '')
        .trim();
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const all = await base44.asServiceRole.entities.AssignmentCatalog.list();

        let updated = 0;
        let skipped = 0;

        for (const record of all || []) {
            const original = record.title || '';
            const cleaned = cleanTitle(original);

            // Derive topic from "Topic - Item N" pattern if not already set
            let topic = record.topic || '';
            if (!topic) {
                const match = original.match(/^(.+?)\s*-\s*(Part|Item)\s*\d+/i);
                topic = match ? match[1].trim() : cleaned;
            }

            const titleChanged = cleaned !== original;
            const topicChanged = !record.topic && !!topic;

            if (titleChanged || topicChanged) {
                const patch = {};
                if (titleChanged) patch.title = cleaned;
                if (topicChanged) patch.topic = topic;

                await base44.asServiceRole.entities.AssignmentCatalog.update(record.id, patch);
                await delay(150); // avoid rate limit
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