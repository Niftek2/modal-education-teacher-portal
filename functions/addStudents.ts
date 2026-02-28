import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const STUDENT_PRODUCT_ID = Deno.env.get("STUDENT_PRODUCT_ID");

const ALL_COURSE_IDS = ['3359727', '422595', '422618', '422620', '496294', '496295', '496297', '496298'];

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json',
};

function generateStudentEmail(firstName, lastInitial) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lastInitial.toLowerCase().replace(/[^a-z]/g, '');
    return `${cleanFirst}${cleanLast}${randomDigits}@modalmath.com`;
}

// Create user; if 422 "already taken", look up by email instead of failing
async function createOrFetchThinkificUser(firstName, lastInitial, email) {
    const res = await fetch('https://api.thinkific.com/api/public/v1/users', {
        method: 'POST',
        headers: thinkificHeaders,
        body: JSON.stringify({ first_name: firstName, last_name: lastInitial, email, password: 'Math1234!', send_welcome_email: false }),
    });

    if (res.ok) return { user: await res.json(), email };

    const err = await res.json().catch(() => ({}));
    const errMsg = (err.message || err.errors?.[0]?.message || '').toLowerCase();

    // Email taken — look up the existing user by email
    if (res.status === 422 && (errMsg.includes('taken') || errMsg.includes('already'))) {
        const lookup = await fetch(
            `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
            { headers: thinkificHeaders }
        );
        if (!lookup.ok) throw new Error(`User exists but lookup failed: ${lookup.status}`);
        const data = await lookup.json();
        const existing = data.items?.[0];
        if (!existing) throw new Error(`User not found after 422: ${email}`);
        return { user: existing, email };
    }

    throw new Error(err.message || err.errors?.[0]?.message || `Failed to create user (${res.status})`);
}

// Generate a unique email and create/fetch the user (retry up to 5x on true collisions)
async function provisionThinkificUser(firstName, lastInitial) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const email = generateStudentEmail(firstName, lastInitial);
        try {
            return await createOrFetchThinkificUser(firstName, lastInitial, email);
        } catch (err) {
            // Only retry if the generated email truly collided
            const msg = (err.message || '').toLowerCase();
            if (msg.includes('taken') || msg.includes('already')) continue;
            throw err;
        }
    }
    throw new Error('Failed to generate unique email after 5 attempts');
}

async function addToGroup(userId, groupId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/groups/${groupId}/members`, {
        method: 'POST',
        headers: thinkificHeaders,
        body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to add to group (${res.status})`);
    }
}

async function enrollInCourse(userId, courseId) {
    const res = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
        method: 'POST',
        headers: thinkificHeaders,
        body: JSON.stringify({ user_id: userId, course_id: courseId, activated_at: new Date().toISOString() }),
    });
    return res.ok;
}

async function enrollInStudentBundle(userId) {
    const res = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
        method: 'POST',
        headers: thinkificHeaders,
        body: JSON.stringify({ user_id: userId, product_id: STUDENT_PRODUCT_ID, activated_at: new Date().toISOString() }),
    });
    return res.ok;
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

        // Resolve groupId from TeacherGroup entity if not provided
        const groupId = providedGroupId || await getGroupIdForTeacher(teacherEmail, base44);
        if (!groupId) return Response.json({ error: 'No groupId found for this teacher. Please contact support.' }, { status: 400 });

        const activeCount = await getActiveStudentCount(teacherEmail, base44);
        const slotsRemaining = 10 - activeCount;
        if (slotsRemaining <= 0)
            return Response.json({ error: 'Roster limit reached (10 active students). Archive a student before adding more.' }, { status: 400 });
        if (students.length > slotsRemaining)
            return Response.json({ error: `You can only add ${slotsRemaining} more student(s). Roster max is 10 active students.` }, { status: 400 });

        const results = [];

        for (const student of students) {
            try {
                const { user, email } = await provisionThinkificUser(student.firstName, student.lastInitial);
                const normalizedEmail = email.toLowerCase().trim();

                // Persist access code
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: normalizedEmail,
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: teacherEmail,
                });

                // Group + enrollments in parallel
                await Promise.all([
                    addToGroup(user.id, groupId),
                    enrollInStudentBundle(user.id),
                    ...ALL_COURSE_IDS.map(courseId => enrollInCourse(user.id, courseId)),
                ]);

                results.push({
                    success: true,
                    student: { id: user.id, firstName: student.firstName, lastInitial: student.lastInitial, email: normalizedEmail, password: 'Math1234!' },
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