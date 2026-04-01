import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { jwtVerify } from 'npm:jose@5.9.6';

const ALLOWED_ADMINS = ['nadiajiftekhar@gmail.com', 'modalmath@gmail.com'];
const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';
const THINKIFIC_HEADERS = {
    'X-Auth-API-Key': Deno.env.get('THINKIFIC_API_KEY') || Deno.env.get('THINKIFIC_API_ACCESS_TOKEN'),
    'X-Auth-Subdomain': Deno.env.get('THINKIFIC_SUBDOMAIN'),
    'Content-Type': 'application/json',
};

async function requireAdminSession(req) {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;
    try {
        const secret = new TextEncoder().encode(Deno.env.get('JWT_SECRET'));
        const { payload } = await jwtVerify(token, secret);
        if (payload.type !== 'session') return null;
        if (!ALLOWED_ADMINS.includes(payload.email?.toLowerCase())) return null;
        return payload;
    } catch { return null; }
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
    const session = await requireAdminSession(req);
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, groupId, newName } = body;

    if (!groupId) return Response.json({ error: 'groupId required' }, { status: 400 });

    // RENAME group in Thinkific + DB
    if (action === 'rename') {
        if (!newName?.trim()) return Response.json({ error: 'newName required' }, { status: 400 });

        const res = await fetch(`${THINKIFIC_BASE}/groups/${groupId}`, {
            method: 'PUT',
            headers: THINKIFIC_HEADERS,
            body: JSON.stringify({ name: newName.trim() }),
        });
        const data = await res.json();
        if (!res.ok) return Response.json({ error: `Thinkific rename failed: ${JSON.stringify(data)}` }, { status: res.status });

        // Update DB record
        const dbRecords = await base44.asServiceRole.entities.TeacherGroup.filter({ thinkificGroupId: groupId });
        await Promise.allSettled(dbRecords.map(r =>
            base44.asServiceRole.entities.TeacherGroup.update(r.id, { thinkificGroupName: newName.trim() })
        ));

        return Response.json({ success: true, newName: newName.trim() });
    }

    // DELETE group from Thinkific + DB
    if (action === 'delete') {
        const res = await fetch(`${THINKIFIC_BASE}/groups/${groupId}`, {
            method: 'DELETE',
            headers: THINKIFIC_HEADERS,
        });
        if (!res.ok && res.status !== 404) {
            const errText = await res.text();
            return Response.json({ error: `Thinkific delete failed (${res.status}): ${errText}` }, { status: res.status });
        }

        // Remove DB records
        const dbRecords = await base44.asServiceRole.entities.TeacherGroup.filter({ thinkificGroupId: groupId });
        await Promise.allSettled(dbRecords.map(r =>
            base44.asServiceRole.entities.TeacherGroup.delete(r.id)
        ));

        return Response.json({ success: true });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
});