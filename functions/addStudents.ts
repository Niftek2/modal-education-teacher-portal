import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
};

const COURSE_ENROLLMENTS = [
    { id: '3359727', name: 'Assignments' },
    { id: '422595',  name: 'PK' },
    { id: '422618',  name: 'K' },
    { id: '422620',  name: 'L1' },
    { id: '496294',  name: 'L2' },
    { id: '496295',  name: 'L3' },
    { id: '496297',  name: 'L4' },
    { id: '496298',  name: 'L5' },
];

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

function generateStudentEmail(firstName, lastInitial) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = (lastInitial || '').charAt(0).toLowerCase().replace(/[^a-z]/, '');
    return `${cleanFirst}${cleanLast}${randomDigits}@modalmath.com`;
}

async function findThinkificUserByEmail(email) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0]?.id || null;
}

async function provisionThinkificUser(firstName, lastInitial) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const email = generateStudentEmail(firstName, lastInitial);
        const existingId = await findThinkificUserByEmail(email);
        if (existingId) {
            console.log(`[addStudents] Found existing user for ${email} (id=${existingId})`);
            return { userId: existingId, email };
        }
        const res = await fetch('https://api.thinkific.com/api/public/v1/users', {
            method: 'POST',
            headers: thinkificHeaders,
            body: JSON.stringify({
                first_name: firstName,
                last_name: lastInitial.charAt(0).toUpperCase(),
                email,
                password: 'Math1234!',
                send_welcome_email: false,
            }),
        });
        const data = await res.json();
        if (res.ok) return { userId: data.id, email };
        const errMsg = (data?.message || data?.errors?.[0]?.message || '').toLowerCase();
        if (res.status === 422 && (errMsg.includes('taken') || errMsg.includes('already'))) continue;
        throw new Error(data?.message || data?.errors?.[0]?.message || `Failed to create user (${res.status})`);
    }
    throw new Error('Failed to generate a unique student email after 5 attempts');
}

async function addToGroup(userId, groupId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/groups/${groupId}/members`, {
        method: 'POST',
        headers: thinkificHeaders,
        body: JSON.stringify({ user_id: userId }),
    });
    if (res.ok || res.status === 404 || res.status === 422) return;
    throw new Error(`Failed to add to group: status ${res.status}`);
}

async function enrollInCourse(userId, courseId) {
    const res = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
        method: 'POST',
        headers: thinkificHeaders,
        body: JSON.stringify({
            user_id: userId,
            course_id: parseInt(courseId, 10),
            activated_at: new Date().toISOString(),
        }),
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    const errMsg = (data?.message || data?.errors?.[0]?.message || '').toLowerCase();
    if (res.status === 422 && (errMsg.includes('already enrolled') || errMsg.includes('already been taken'))) return true;
    return false;
}

async function getActiveStudentCount(teacherEmail, base44) {
    const [studentCodes, archivedStudents] = await Promise.all([
        base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
        base44.asServiceRole.entities.ArchivedStudent.filter({ teacherEmail }),
    ]);
    const archivedEmailSet = new Set(
        (archivedStudents || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
    );
    return (studentCodes || []).filter(s => {
        const email = s.studentEmail?.toLowerCase().trim();
        return email && !archivedEmailSet.has(email);
    }).length;
}

Deno.serve(async (req) => {
    try {
        const session = await requireSession(req);
        const base44 = createClientFromRequest(req);
        const { teacherEmail: bodyEmail, students, groupId: providedGroupId } = await req.json();

        const teacherEmail = (bodyEmail || session?.email)?.toLowerCase().trim();
        if (!teacherEmail) return Response.json({ error: 'teacherEmail is required (Unauthorized)' }, { status: 401 });
        if (!students || !Array.isArray(students) || students.length === 0)
            return Response.json({ error: 'students array is required' }, { status: 400 });
        if (students.length > 10)
            return Response.json({ error: 'Maximum 10 students per request' }, { status: 400 });

        const groupId = providedGroupId || null;

        const activeCount = await getActiveStudentCount(teacherEmail, base44);
        if (activeCount + students.length > 10)
            return Response.json({ error: 'Roster limit reached (10 active students)' }, { status: 400 });

        const results = [];

        for (const student of students) {
            try {
                const { userId, email } = await provisionThinkificUser(student.firstName, student.lastInitial);
                const normalizedEmail = email.toLowerCase().trim();

                // Save to StudentAccessCode with groupId — this is the Assign page's source of truth
                try {
                    await base44.asServiceRole.entities.StudentAccessCode.create({
                        studentEmail: normalizedEmail,
                        createdAt: new Date().toISOString(),
                        createdByTeacherEmail: teacherEmail,
                        groupId: groupId || null,
                    });
                } catch (dbErr) {
                    console.error(`[addStudents] DB write failed for ${normalizedEmail}:`, dbErr.message);
                }

                // Add to teacher's Thinkific group — this is the Roster page's source of truth
                if (groupId) {
                    try {
                        await addToGroup(userId, groupId);
                    } catch (groupErr) {
                        console.warn(`[addStudents] Group add failed for userId=${userId}:`, groupErr.message);
                    }
                }

                // Enroll in all courses sequentially
                const enrollmentResults = [];
                const failedCourses = [];
                for (const course of COURSE_ENROLLMENTS) {
                    try {
                        const ok = await enrollInCourse(userId, course.id);
                        enrollmentResults.push({ course: course.name, success: ok });
                        if (!ok) failedCourses.push(course.name);
                    } catch (err) {
                        console.error(`[addStudents] Failed to enroll in ${course.name}:`, err.message);
                        enrollmentResults.push({ course: course.name, success: false, error: err.message });
                        failedCourses.push(course.name);
                    }
                }

                results.push({
                    success: true,
                    student: {
                        id: userId,
                        firstName: student.firstName,
                        lastInitial: student.lastInitial,
                        email: normalizedEmail,
                        password: 'Math1234!',
                    },
                    enrollmentResults,
                    failedCourses,
                });
            } catch (error) {
                console.error(`[addStudents] Failed for ${student.firstName}:`, error.message);
                results.push({ success: false, firstName: student.firstName, error: error.message });
            }
        }

        return Response.json({ results });

    } catch (error) {
        console.error('Add students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});