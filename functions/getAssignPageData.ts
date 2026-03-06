import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

async function requireSession(req) {
    const JWT_SECRET = Deno.env.get("JWT_SECRET");
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

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const YOUR_CLASSROOM_COURSE_ID = 552235;

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
};

async function isTeacherEnrolledInClassroom(teacherEmail) {
    // Find Thinkific user by email
    const userRes = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(teacherEmail)}`,
        { headers: thinkificHeaders }
    );
    if (!userRes.ok) return false;
    const userData = await userRes.json();
    const userId = userData.items?.[0]?.id;
    if (!userId) return false;

    // Check enrollments for Your Classroom course
    const enrollRes = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${YOUR_CLASSROOM_COURSE_ID}&limit=1`,
        { headers: thinkificHeaders }
    );
    if (!enrollRes.ok) return false;
    const enrollData = await enrollRes.json();
    return (enrollData.items?.length || 0) > 0;
}

/**
 * Returns the teacher's student roster from StudentAccessCode table.
 * Auth: magic-link session JWT (modal_math_session) passed as Bearer token.
 * Teacher must be enrolled in Your Classroom course (552235).
 */
Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!session.isTeacher && session.role !== 'teacher') {
        return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email?.toLowerCase().trim();

        console.log(`[getAssignPageData] Fetching roster for teacher: ${teacherEmail}`);

        // Verify teacher is enrolled in Your Classroom (552235) — sole teacher indicator
        const isValidTeacher = await isTeacherEnrolledInClassroom(teacherEmail);
        if (!isValidTeacher) {
            console.warn(`[getAssignPageData] Teacher ${teacherEmail} not enrolled in Your Classroom course`);
            return Response.json({ error: "Forbidden: Teacher not enrolled in Your Classroom." }, { status: 403 });
        }

        // Get all students created by this teacher
        const studentCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({
            createdByTeacherEmail: teacherEmail
        });

        // Get archived students to exclude from active roster
        const archivedStudents = await base44.asServiceRole.entities.ArchivedStudent.filter({});
        const archivedEmailSet = new Set(
            archivedStudents.map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        // Filter: only @modalmath.com, only active (not archived)
        const studentEmails = (studentCodes || [])
            .map(s => s.studentEmail?.toLowerCase().trim())
            .filter(email => email && email.endsWith('@modalmath.com') && !archivedEmailSet.has(email))
            .sort();

        console.log(`[getAssignPageData] Found ${studentEmails.length} active students for ${teacherEmail}`);

        return Response.json({ success: true, studentEmails });

    } catch (error) {
        console.error('[getAssignPageData] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});