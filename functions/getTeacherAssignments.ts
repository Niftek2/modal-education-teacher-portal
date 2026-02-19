import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const CLASSROOM_COURSE_ID = '552235'; // "Your Classroom" course

async function hasClassroomEnrollment(userEmail) {
    // Step 1: look up user by email
    const userRes = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(userEmail)}`,
        {
            headers: {
                'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        }
    );
    if (!userRes.ok) return false;
    const userData = await userRes.json();
    const userId = userData.items?.[0]?.id;
    if (!userId) return false;

    // Step 2: check if ANY enrollment exists for this course (any status)
    const enrollRes = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${CLASSROOM_COURSE_ID}&limit=1`,
        {
            headers: {
                'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        }
    );
    if (!enrollRes.ok) return false;
    const enrollData = await enrollRes.json();
    return (enrollData.items || []).length > 0;
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email?.toLowerCase().trim();

        // Instruction 3: allow any enrollment status, not just 'active'
        const isTeacher = session.isTeacher || session.role === 'teacher' || await hasClassroomEnrollment(teacherEmail);
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
            ...activeEmails.map(email => ({ email, archived: false })),
            ...archivedEmails.map(email => ({ email, archived: true }))
        ];

        // Instruction 5: return { success, students, catalog, assignments }
        return Response.json({
            success: true,
            students: roster,
            catalog: catalogItems || [],
            assignments: (assignments || []).sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
        });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});