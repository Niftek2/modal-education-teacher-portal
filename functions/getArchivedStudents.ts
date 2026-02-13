import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sessionToken } = await req.json();
        const session = await verifySession(sessionToken);

        // Fetch archived students for this teacher
        const archived = await base44.asServiceRole.entities.ArchivedStudent.filter({
            teacherThinkificUserId: String(session.userId)
        });

        // Sort by archived date, most recent first
        archived.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

        return Response.json({ students: archived });

    } catch (error) {
        console.error('Get archived students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});