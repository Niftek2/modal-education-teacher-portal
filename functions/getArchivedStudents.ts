import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);

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