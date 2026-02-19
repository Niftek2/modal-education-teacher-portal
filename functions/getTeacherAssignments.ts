import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function getSession(req) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return { session: null, expired: false };
    const token = authHeader.substring(7);
    try {
        const secret = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret);
        return { session: payload, expired: false };
    } catch (e) {
        const expired = e.code === 'ERR_JWT_EXPIRED';
        return { session: null, expired };
    }
}

Deno.serve(async (req) => {
    const { session, expired } = await getSession(req);

    if (!session) {
        const msg = expired ? "Session expired, please log in again." : "Unauthorized.";
        return Response.json({ error: msg, reason: expired ? "token_expired" : "invalid_token" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email?.toLowerCase().trim();

        const isTeacher = session.isTeacher === true || session.role === 'teacher';
        if (!isTeacher) {
            return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
        }

        // Instruction 4: DB is source of truth for roster
        const [studentCodes, archivedStudents, assignments, catalogItems] = await Promise.all([
            base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
            base44.asServiceRole.entities.ArchivedStudent.filter({}),
            base44.asServiceRole.entities.StudentAssignment.filter({ teacherEmail }),
            base44.asServiceRole.entities.AssignmentCatalog.filter({ isActive: true })
        ]);

        const archivedEmailSet = new Set(
            (archivedStudents || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        // Active students first, archived at the bottom
        const allEmails = (studentCodes || [])
            .map(s => s.studentEmail?.toLowerCase().trim())
            .filter(email => email && email.endsWith('@modalmath.com'));

        const activeEmails = allEmails.filter(e => !archivedEmailSet.has(e)).sort();
        const archivedEmails = allEmails.filter(e => archivedEmailSet.has(e)).sort();

        const roster = [
            ...activeEmails.map(email => ({ email, isArchived: false })),
            ...archivedEmails.map(email => ({ email, isArchived: true }))
        ];

        // Stable sort: active first, archived last
        roster.sort((a, b) => (a.isArchived === b.isArchived) ? 0 : a.isArchived ? 1 : -1);

        const activeCatalog = (catalogItems || []).filter(item => item.isActive !== false);

        return Response.json({
            success: true,
            students: roster,
            catalog: activeCatalog,
            assignments: (assignments || []).sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt)),
            ...(activeCatalog.length === 0 ? { message: "No active catalog items found" } : {})
        });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});