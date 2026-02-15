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

        // Verify teacher session
        const session = await verifySession(sessionToken);
        const teacherEmail = session.email;

        if (!teacherEmail || !teacherEmail.endsWith('@modalmath.com')) {
            return Response.json({ error: 'Invalid teacher session' }, { status: 401 });
        }

        // Get all assignments for this teacher
        const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
            teacherEmail
        });

        // Sort by assigned date (newest first)
        const sorted = (assignments || []).sort((a, b) => 
            new Date(b.assignedAt) - new Date(a.assignedAt)
        );

        return Response.json({
            success: true,
            assignments: sorted
        });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});