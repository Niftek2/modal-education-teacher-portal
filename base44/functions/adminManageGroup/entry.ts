import { createClient } from 'npm:@base44/sdk@0.8.23';
import { jwtVerify } from 'npm:jose@5.9.6';

const base44 = createClient({ appId: Deno.env.get('BASE44_APP_ID') });

const ALLOWED_ADMINS = ['nadiajiftekhar@gmail.com', 'modalmath@gmail.com'];
const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';
const THINKIFIC_TOKEN = Deno.env.get('THINKIFIC_API_KEY') || Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');

const COURSE_IDS = [
    Deno.env.get('PK_COURSE_ID'),
    Deno.env.get('K_COURSE_ID'),
    Deno.env.get('L1_COURSE_ID'),
    Deno.env.get('L2_COURSE_ID'),
    Deno.env.get('L3_COURSE_ID'),
    Deno.env.get('L4_COURSE_ID'),
    Deno.env.get('L5_COURSE_ID'),
].filter(Boolean);

const THINKIFIC_HEADERS = {
    'X-Auth-API-Key': THINKIFIC_TOKEN,
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

async function thinkificGet(path) {
    const res = await fetch(`${THINKIFIC_BASE}${path}`, { headers: THINKIFIC_HEADERS });
    if (!res.ok) {
        const errText = await res.text();
        console.error(`Thinkific GET ${path} failed ${res.status}:`, errText);
        return null;
    }
    return res.json();
}

async function thinkificPost(path, body) {
    const res = await fetch(`${THINKIFIC_BASE}${path}`, {
        method: 'POST',
        headers: THINKIFIC_HEADERS,
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
}

async function thinkificDelete(path) {
    const res = await fetch(`${THINKIFIC_BASE}${path}`, {
        method: 'DELETE',
        headers: THINKIFIC_HEADERS,
    });
    return { ok: res.ok, status: res.status };
}

async function findUserByEmail(email) {
    const data = await thinkificGet(`/users?query[email]=${encodeURIComponent(email)}`);
    const users = data?.items || [];
    return users.length > 0 ? users[0] : null;
}

async function addStudentToGroup(studentEmail, groupId, teacherEmail) {
    const user = await findUserByEmail(studentEmail);
    if (!user) throw new Error(`No Thinkific user found for ${studentEmail}`);

    const addResult = await thinkificPost(`/groups/${groupId}/members`, { user_id: user.id });
    if (!addResult.ok && addResult.status !== 422) {
        throw new Error(`Failed to add ${studentEmail} to group: ${addResult.status}`);
    }

    await Promise.allSettled(COURSE_IDS.map(courseId =>
        thinkificPost('/enrollments', { user_id: user.id, course_id: Number(courseId), activated_at: new Date().toISOString() })
    ));

    const existing = await base44.entities.StudentAccessCode.filter({ studentEmail: studentEmail.toLowerCase() });
    if (existing.length === 0) {
        await base44.entities.StudentAccessCode.create({
            studentEmail: studentEmail.toLowerCase(),
            createdAt: new Date().toISOString(),
            createdByTeacherEmail: teacherEmail,
        });
    }

    return { success: true, userId: user.id };
}

async function removeStudentFromGroup(studentEmail, groupId, userId, teacherEmail) {
    const memberData = await thinkificGet(`/group_users?query[group_id]=${groupId}&query[user_id]=${userId}`);
    const membership = memberData?.items?.[0];
    if (membership) {
        await thinkificDelete(`/group_users/${membership.id}`);
    }

    const user = await findUserByEmail(studentEmail);
    const firstName = user?.first_name || studentEmail.split('@')[0];
    const lastName = user?.last_name || '';

    const existing = await base44.entities.ArchivedStudent.filter({ studentEmail: studentEmail.toLowerCase(), teacherEmail });
    if (existing.length === 0) {
        await base44.entities.ArchivedStudent.create({
            studentEmail: studentEmail.toLowerCase(),
            studentFirstName: firstName,
            studentLastName: lastName,
            studentThinkificUserId: String(userId),
            teacherEmail,
            groupId: String(groupId),
            archivedAt: new Date().toISOString(),
        });
    }

    const codes = await base44.entities.StudentAccessCode.filter({ studentEmail: studentEmail.toLowerCase() });
    await Promise.allSettled(codes.map(c => base44.entities.StudentAccessCode.delete(c.id)));

    return { success: true };
}

async function syncTeacherGroup(teacherEmail, groupId) {
    const accessCodes = await base44.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail });
    const archived = await base44.entities.ArchivedStudent.filter({ teacherEmail });
    const archivedEmails = new Set(archived.map(a => a.studentEmail?.toLowerCase()));

    const activeStudents = accessCodes.filter(c => !archivedEmails.has(c.studentEmail?.toLowerCase()));

    const results = { added: [], skipped: [], errors: [] };

    // Get current group members to avoid duplicate adds
    const currentMembers = await thinkificGet(`/users?query[group_id]=${groupId}&limit=100`);
    const currentEmails = new Set((currentMembers?.items || []).map(u => u.email?.toLowerCase()));

    console.log(`[sync] Group ${groupId} has ${currentEmails.size} current members. DB has ${activeStudents.length} active students.`);

    for (const student of activeStudents) {
        const email = student.studentEmail?.toLowerCase();
        if (!email) continue;

        if (currentEmails.has(email)) {
            results.skipped.push(email);
            continue;
        }

        try {
            const user = await findUserByEmail(email);
            if (!user) {
                console.warn(`[sync] No Thinkific user for ${email}`);
                results.errors.push({ email, reason: 'User not found in Thinkific' });
                continue;
            }

            console.log(`[sync] Adding ${email} (userId=${user.id}) to group ${groupId}`);
            const addResult = await thinkificPost(`/groups/${groupId}/members`, { user_id: user.id });
            if (!addResult.ok && addResult.status !== 422) {
                throw new Error(`Status ${addResult.status}: ${JSON.stringify(addResult.data)}`);
            }

            await Promise.allSettled(COURSE_IDS.map(courseId =>
                thinkificPost('/enrollments', { user_id: user.id, course_id: Number(courseId), activated_at: new Date().toISOString() })
            ));

            results.added.push(email);
        } catch (e) {
            console.error(`[sync] Error adding ${email}:`, e.message);
            results.errors.push({ email, reason: e.message });
        }
    }

    return results;
}

Deno.serve(async (req) => {
    try {
        const session = await requireAdminSession(req);
        if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await req.json();
        const { action, studentEmail, groupId, userId, teacherEmail } = body;

        if (action === 'add') {
            if (!studentEmail || !groupId || !teacherEmail) return Response.json({ error: 'studentEmail, groupId, teacherEmail required' }, { status: 400 });
            const result = await addStudentToGroup(studentEmail, groupId, teacherEmail);
            return Response.json(result);
        }

        if (action === 'remove') {
            if (!studentEmail || !groupId || !userId || !teacherEmail) return Response.json({ error: 'studentEmail, groupId, userId, teacherEmail required' }, { status: 400 });
            const result = await removeStudentFromGroup(studentEmail, groupId, userId, teacherEmail);
            return Response.json(result);
        }

        if (action === 'sync') {
            if (!teacherEmail || !groupId) return Response.json({ error: 'teacherEmail, groupId required' }, { status: 400 });
            const result = await syncTeacherGroup(teacherEmail, groupId);
            return Response.json(result);
        }

        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    } catch (error) {
        console.error('adminManageGroup error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});