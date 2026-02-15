import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jwtVerify } from 'npm:jose@5.9.6';

const JWT_SECRET = Deno.env.get('JWT_SECRET');

async function verifyStudentSession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== 'student') {
        throw new Error('Invalid session type');
    }
    return payload;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sessionToken } = await req.json();

        // Verify student session
        const session = await verifyStudentSession(sessionToken);
        const studentEmail = session.email;

        // Get assignments for this student
        const assignments = await base44.asServiceRole.entities.StudentAssignment.filter({
            studentEmail,
            status: { $ne: 'archived' }
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
        console.error('Get student assignments error:', error);
        return Response.json({ error: error.message }, { status: 401 });
    }
});