import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requestRest } from './lib/thinkificClient.ts';

// Ordered list of course IDs to enroll each student in, one-by-one
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

function generateStudentEmail(firstName, lastInitial) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    // Take only the first character of lastInitial
    const cleanLast = (lastInitial || '').charAt(0).toLowerCase().replace(/[^a-z]/, '');
    return `${cleanFirst}${cleanLast}${randomDigits}@modalmath.com`;
}

// Check if a Thinkific user already exists by email
async function findThinkificUserByEmail(email) {
    const res = await requestRest('/users', 'GET', { 'query[email]': email });
    if (res.ok && res.data?.items?.length > 0) {
        return res.data.items[0].id;
    }
    return null;
}

// Create a new Thinkific user, or return the existing user's ID if email is taken
async function provisionThinkificUser(firstName, lastInitial) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const email = generateStudentEmail(firstName, lastInitial);

        // Check-before-create: skip POST if user already exists
        const existingId = await findThinkificUserByEmail(email);
        if (existingId) {
            console.log(`[addStudents] Found existing user for ${email} (id=${existingId})`);
            return { userId: existingId, email };
        }

        const createRes = await requestRest('/users', 'POST', null, {
            first_name: firstName,
            last_name: lastInitial.charAt(0).toUpperCase(),
            email,
            password: 'Math1234!',
            send_welcome_email: false,
        });

        if (createRes.ok) {
            return { userId: createRes.data.id, email };
        }

        const errMsg = (createRes.data?.message || createRes.data?.errors?.[0]?.message || '').toLowerCase();

        if (createRes.status === 422 && (errMsg.includes('taken') || errMsg.includes('already'))) {
            // Email collision on a generated address — retry with a new one
            continue;
        }

        throw new Error(createRes.data?.message || createRes.data?.errors?.[0]?.message || `Failed to create user (${createRes.status})`);
    }
    throw new Error('Failed to generate a unique student email after 5 attempts');
}

async function addToGroup(userId, groupId) {
    const res = await requestRest(`/groups/${groupId}/members`, 'POST', null, { user_id: userId });
    if (res.ok) return;
    const errMsg = (res.data?.message || res.data?.errors?.[0]?.message || '').toLowerCase();
    // Treat "already a member" as success
    if (res.status === 422 && (errMsg.includes('already') || errMsg.includes('member'))) return;
    throw new Error(`Failed to add to group: ${res.data?.message || `status ${res.status}`}`);
}

async function enrollInCourse(userId, courseId) {
    const res = await requestRest('/enrollments', 'POST', null, {
        user_id: userId,
        course_id: parseInt(courseId, 10),
        activated_at: new Date().toISOString(),
    });
    if (res.ok) return true;
    // Treat "already enrolled" as success — idempotent
    const errMsg = (res.data?.message || res.data?.errors?.[0]?.message || '').toLowerCase();
    if (res.status === 422 && (errMsg.includes('already enrolled') || errMsg.includes('already been taken'))) {
        return true;
    }
    return false;
}

async function getGroupIdForTeacher(teacherEmail, base44) {
    const records = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
    return records?.[0]?.thinkificGroupId || null;
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
        const base44 = createClientFromRequest(req);
        const { teacherEmail: rawTeacherEmail, groupId: providedGroupId, students } = await req.json();

        const teacherEmail = rawTeacherEmail?.toLowerCase().trim();
        if (!teacherEmail) return Response.json({ error: 'teacherEmail is required' }, { status: 400 });
        if (!students || !Array.isArray(students) || students.length === 0)
            return Response.json({ error: 'students array is required' }, { status: 400 });
        if (students.length > 10)
            return Response.json({ error: 'Maximum 10 students per request' }, { status: 400 });

        const groupId = providedGroupId || await getGroupIdForTeacher(teacherEmail, base44);
        if (!groupId) return Response.json({ error: 'No groupId found for this teacher. Please contact support.' }, { status: 400 });

        const activeCount = await getActiveStudentCount(teacherEmail, base44);
        if (activeCount + students.length > 10)
            return Response.json({ error: 'Roster limit reached (10 active students)' }, { status: 400 });

        const results = [];

        for (const student of students) {
            try {
                const { userId, email } = await provisionThinkificUser(student.firstName, student.lastInitial);
                const normalizedEmail = email.toLowerCase().trim();

                // Always persist to StudentAccessCode so this teacher's roster is correct
                // Non-fatal: enrollment is the priority if DB write fails
                try {
                    await base44.asServiceRole.entities.StudentAccessCode.create({
                        studentEmail: normalizedEmail,
                        createdAt: new Date().toISOString(),
                        createdByTeacherEmail: teacherEmail,
                    });
                } catch (dbErr) {
                    console.error(`[addStudents] DB write failed for ${normalizedEmail}:`, dbErr.message);
                }

                // Add to group
                await addToGroup(userId, groupId);

                // Sequential per-course enrollment with granular error reporting
                const enrollmentResults = [];
                const failedCourses = [];
                for (const course of COURSE_ENROLLMENTS) {
                    try {
                        const ok = await enrollInCourse(userId, course.id);
                        enrollmentResults.push({ course: course.name, success: ok });
                        if (!ok) {
                            console.warn(`[addStudents] Enrollment non-ok for ${course.name} (userId=${userId})`);
                            failedCourses.push(course.name);
                        }
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