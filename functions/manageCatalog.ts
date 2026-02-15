import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jwtVerify } from 'npm:jose@5.9.6';

const JWT_SECRET = Deno.env.get('JWT_SECRET');

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sessionToken, action, data, catalogId } = await req.json();

        // Verify admin session
        const session = await verifySession(sessionToken);
        
        // Check if user is admin (this assumes you have user role stored somewhere)
        // For now, just check they're logged in as teacher
        if (!session.email || !session.email.endsWith('@modalmath.com')) {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        if (action === 'create') {
            const created = await base44.asServiceRole.entities.AssignmentCatalog.create(data);
            return Response.json({ success: true, catalog: created });
        }

        if (action === 'update' && catalogId) {
            const updated = await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, data);
            return Response.json({ success: true, catalog: updated });
        }

        if (action === 'list') {
            const catalog = await base44.asServiceRole.entities.AssignmentCatalog.list();
            return Response.json({ success: true, catalog });
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