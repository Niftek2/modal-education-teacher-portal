import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const REST_BASE = "https://api.thinkific.com/api/public/v1";

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
};

async function requireSession(req) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.substring(7);
    try {
        const secret = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret);
        return payload;
    } catch {
        return null;
    }
}

async function findUserByEmail(email) {
    const res = await fetch(
        `${REST_BASE}/users?query[email]=${encodeURIComponent(email)}`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to find user: ${res.status}`);
    const data = await res.json();
    return data.items?.[0] || null;
}

async function listGroups() {
    const res = await fetch(`${REST_BASE}/groups`, { headers: thinkificHeaders });
    if (!res.ok) throw new Error(`Failed to list groups: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

async function listGroupUsers(groupId) {
    const res = await fetch(
        `${REST_BASE}/group_users?query[group_id]=${groupId}`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to list group users: ${res.status}`);
    const data = await res.json();
    return data.items || [];
}

Deno.serve(async (req) => {
    const session = await requireSession(req);
    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { studentEmail, teacherEmail, groupName } = await req.json();

        if (!studentEmail || !teacherEmail || !groupName) {
            return Response.json({
                error: 'Missing required fields: studentEmail, teacherEmail, groupName'
            }, { status: 400 });
        }

        console.log(`[LOOKUP] Searching for student: ${studentEmail}`);
        console.log(`[LOOKUP] Searching for teacher: ${teacherEmail} with group: ${groupName}`);

        // 1. Find student by email
        const student = await findUserByEmail(studentEmail);
        if (!student) {
            return Response.json({
                error: `Student not found in Thinkific: ${studentEmail}`
            }, { status: 404 });
        }

        console.log(`[LOOKUP] Found student: ID ${student.id}, Email ${student.email}`);

        // 2. Find teacher's group
        const allGroups = await listGroups();
        console.log(`[LOOKUP] Total groups in Thinkific: ${allGroups.length}`);

        const matchingGroups = allGroups.filter(g => g.name === groupName);
        console.log(`[LOOKUP] Found ${matchingGroups.length} groups matching "${groupName}"`);

        if (matchingGroups.length === 0) {
            return Response.json({
                error: `Group not found: ${groupName}`,
                availableGroups: allGroups.map(g => ({ id: g.id, name: g.name }))
            }, { status: 404 });
        }

        // 3. Find the group containing the student — check both top-level and nested user.email
        const targetEmailLower = studentEmail.toLowerCase();
        let targetGroup = null;
        for (const group of matchingGroups) {
            const groupUsers = await listGroupUsers(group.id);
            const studentInGroup = groupUsers.find(u =>
                (u.user?.email?.toLowerCase() === targetEmailLower) ||
                (u.email?.toLowerCase() === targetEmailLower)
            );
            if (studentInGroup) {
                targetGroup = group;
                console.log(`[LOOKUP] Found student in group ID ${group.id}`);
                break;
            }
        }

        // Fall back to first matching group if not found in any
        if (!targetGroup) {
            targetGroup = matchingGroups[0];
            console.log(`[LOOKUP] Student not found in any matching group, using first match: ${targetGroup.id}`);
        }

        return Response.json({
            success: true,
            studentId: student.id,
            studentEmail: student.email,
            studentName: `${student.first_name} ${student.last_name}`.trim(),
            groupId: targetGroup.id,
            groupName: targetGroup.name,
            teacherId: session.userId
        });

    } catch (error) {
        console.error('[LOOKUP] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});