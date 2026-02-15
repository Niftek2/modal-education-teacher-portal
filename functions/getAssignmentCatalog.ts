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
        const { sessionToken } = await req.json();

        // Verify session
        const session = await verifySession(sessionToken);
        const userEmail = session.email;

        if (!userEmail) {
            return Response.json({ error: 'Invalid session' }, { status: 401 });
        }

        // Get active catalog items
        const catalog = await base44.asServiceRole.entities.AssignmentCatalog.filter({ 
            isActive: true 
        });

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