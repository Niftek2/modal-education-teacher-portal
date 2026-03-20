import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const session = await requireSession(req);

        if (!session) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, data, catalogId } = await req.json();

        // Admin-only actions: create, update, toggle
        const adminActions = ['create', 'update', 'toggle'];
        if (adminActions.includes(action) && !session.email?.endsWith('@modalmath.com')) {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        if (action === 'list') {
            const PAGE_SIZE = 2000;
            let all = [];
            let offset = 0;

            while (true) {
                const page = await base44.asServiceRole.entities.AssignmentCatalog.list('title', PAGE_SIZE, offset);
                const items = Array.isArray(page) ? page : [];
                all = all.concat(items);
                if (items.length < PAGE_SIZE) break;
                offset += PAGE_SIZE;
            }

            all.sort((a, b) =>
                (a.level || '').localeCompare(b.level || '') ||
                (a.title || '').localeCompare(b.title || '')
            );

            console.log(`[manageCatalog] Returning ${all.length} total catalog items`);
            return Response.json({ success: true, catalog: all });
        }

        if (action === 'create') {
            const created = await base44.asServiceRole.entities.AssignmentCatalog.create(data);
            return Response.json({ success: true, catalog: created });
        }

        if (action === 'update' && catalogId) {
            const updated = await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, data);
            return Response.json({ success: true, catalog: updated });
        }

        if (action === 'toggle' && catalogId) {
            const items = await base44.asServiceRole.entities.AssignmentCatalog.filter({ id: catalogId });
            if (!items || items.length === 0) {
                return Response.json({ error: 'Not found' }, { status: 404 });
            }
            const updated = await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, {
                isActive: !items[0].isActive
            });
            return Response.json({ success: true, catalog: updated });
        }

        return Response.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error) {
        console.error('Manage catalog error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});