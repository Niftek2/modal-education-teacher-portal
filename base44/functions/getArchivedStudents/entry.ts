import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import * as jose from 'npm:jose@5.9.6';

async function requireSession(req) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.substring(7);
    try {
        const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
        const { payload } = await jose.jwtVerify(token, secret);
        return payload;
    } catch { return null; }
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);

        // Fetch archived students for this teacher
        const teacherEmail = session.email?.toLowerCase().trim();
        const archived = await base44.asServiceRole.entities.ArchivedStudent.filter({
            teacherEmail
        });

        // Sort by archived date, most recent first
        archived.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));

        return Response.json({ students: archived });

    } catch (error) {
        console.error('Get archived students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});