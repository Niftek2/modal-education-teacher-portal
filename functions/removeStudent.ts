import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function getStudentInfo(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        }
    });

    if (!response.ok) {
        return null;
    }

    return await response.json();
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const { studentId, groupId, teacherId } = await req.json();

        if (!studentId || !groupId) {
            return Response.json({ error: 'Student ID and Group ID required' }, { status: 400 });
        }

        // Get student info
        const studentInfo = await getStudentInfo(studentId);

        if (!studentInfo) {
            return Response.json({ error: 'Student not found' }, { status: 404 });
        }

        // Archive the student record
        await base44.asServiceRole.entities.ArchivedStudent.create({
            studentThinkificUserId: String(studentId),
            studentEmail: studentInfo.email,
            studentFirstName: studentInfo.first_name,
            studentLastName: studentInfo.last_name,
            teacherThinkificUserId: String(teacherId || session.userId),
            groupId: String(groupId),
            archivedAt: new Date().toISOString()
        });

        return Response.json({ success: true });

    } catch (error) {
        console.error('Remove student error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});