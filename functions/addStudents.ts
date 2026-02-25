import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const STUDENT_PRODUCT_ID = Deno.env.get("STUDENT_PRODUCT_ID");

const CLASSROOM_COURSE_ID = Deno.env.get("CLASSROOM_COURSE_ID");

// In-memory cache: email -> { allowed: bool, checkedAt: timestamp }
const enrollmentCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function thinkificGet(path) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1${path}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json',
        },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

async function assertTeacherAccess(session) {
    const email = session?.email?.trim().toLowerCase();
    if (!email) {
        console.log(`[addStudents] DENY_401: no email in session`);
        throw Object.assign(new Error('Please sign in again.'), { status: 401 });
    }

    // Check in-memory cache first
    const cached = enrollmentCache.get(email);
    if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) {
        if (cached.allowed) {
            console.log(`[addStudents] ALLOW (cached) email=${email}`);
            return;
        } else {
            console.log(`[addStudents] DENY_403 (cached) email=${email} enrollmentFound=false`);
            throw Object.assign(new Error("Access required: enroll in 'Your Classroom' to add students."), { status: 403 });
        }
    }

    // Look up Thinkific user by email
    const userRes = await thinkificGet(`/users?query[email]=${encodeURIComponent(email)}`);
    const thinkificUser = (userRes.data?.items || [])[0] || null;
    const thinkificUserId = thinkificUser?.id || null;

    let enrollmentFound = false;
    if (thinkificUserId) {
        const enrollRes = await thinkificGet(`/enrollments?query[user_id]=${thinkificUserId}&query[course_id]=${CLASSROOM_COURSE_ID}`);
        const enrollments = enrollRes.data?.items || [];
        enrollmentFound = enrollments.some(e =>
            e.activated_at && (!e.expiry_date || new Date(e.expiry_date) > new Date())
        );
    }

    const decision = enrollmentFound ? 'ALLOW' : 'DENY_403';
    console.log(`[addStudents] ${decision} email=${email} sessionPresent=true thinkificUserId=${thinkificUserId} enrollmentFound=${enrollmentFound} course=${CLASSROOM_COURSE_ID}`);

    // Cache result
    enrollmentCache.set(email, { allowed: enrollmentFound, checkedAt: Date.now() });

    if (!enrollmentFound) {
        throw Object.assign(new Error("Access required: enroll in 'Your Classroom' to add students."), { status: 403 });
    }
}

// Hardcoded course IDs — never rely on env vars so this cannot break
const ASSIGNMENTS_COURSE_ID = '3359727';
const LEVEL_COURSE_IDS = ['422595', '422618', '422620', '496294', '496295', '496297', '496298'];

function generateStudentEmail(firstName, lastInitial) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lastInitial.toLowerCase().replace(/[^a-z]/g, '');
    return `${cleanFirst}${cleanLast}${randomDigits}@modalmath.com`;
}

async function createThinkificUser(firstName, lastInitial, email) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/users', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            first_name: firstName,
            last_name: lastInitial,
            email: email,
            password: 'Math1234!',
            send_welcome_email: false
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const msg = error.message || error.errors?.[0]?.message || 'Failed to create user';
        throw new Error(msg);
    }

    return await response.json();
}

// Retry email generation up to 5 times if email is already taken
async function createThinkificUserWithRetry(firstName, lastInitial) {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
        const email = generateStudentEmail(firstName, lastInitial);
        try {
            const user = await createThinkificUser(firstName, lastInitial, email);
            return { user, email };
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            if (msg.includes('already') || msg.includes('taken') || msg.includes('exist')) {
                lastError = err;
                continue;
            }
            throw err; // non-duplicate error — rethrow immediately
        }
    }
    throw lastError || new Error('Failed to generate unique email after 5 attempts');
}

async function addToGroup(userId, groupId) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/group_memberships', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: userId, group_id: groupId })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('Add to group failed:', { status: response.status, error, userId, groupId });
        throw new Error(error.message || `Failed to add to group (${response.status})`);
    }

    return await response.json();
}

async function enrollInCourse(userId, courseId) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: userId,
            course_id: courseId,
            activated_at: new Date().toISOString()
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error(`Enrollment failed for course ${courseId}:`, error);
    }
    return response.ok;
}

async function enrollInStudentBundle(userId) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: userId,
            product_id: STUDENT_PRODUCT_ID,
            activated_at: new Date().toISOString()
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('Bundle enrollment error:', error);
    }
    return response.ok;
}

async function getActiveStudentCount(teacherEmail, base44) {
    const [studentCodes, archivedStudents] = await Promise.all([
        base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
        base44.asServiceRole.entities.ArchivedStudent.filter({})
    ]);

    const archivedEmailSet = new Set(
        (archivedStudents || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
    );

    const activeCount = (studentCodes || []).filter(s => {
        const email = s.studentEmail?.toLowerCase().trim();
        return email && email.endsWith('@modalmath.com') && !archivedEmailSet.has(email);
    }).length;

    return activeCount;
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        console.log(`[addStudents] DENY_401: sessionPresent=false enrollmentFound=false decision=DENY_401`);
        return Response.json({ error: "Please sign in again." }, { status: 401 });
    }

    try {
        await assertTeacherAccess(session);
    } catch (err) {
        return Response.json({ error: err.message }, { status: err.status || 403 });
    }

    try {
        const { students } = await req.json();
        const base44 = createClientFromRequest(req);

        if (!students || !Array.isArray(students) || students.length === 0) {
            return Response.json({ error: 'Students array required' }, { status: 400 });
        }

        if (students.length > 10) {
            return Response.json({ error: 'Maximum 10 students per request' }, { status: 400 });
        }

        // Check roster cap — block entire request if it would exceed 10
        const activeCount = await getActiveStudentCount(session.email, base44);
        const slotsRemaining = 10 - activeCount;

        if (slotsRemaining <= 0) {
            return Response.json({
                error: 'Roster limit reached (10 active students). Archive a student before adding more.'
            }, { status: 400 });
        }

        if (students.length > slotsRemaining) {
            return Response.json({
                error: `You can only add ${slotsRemaining} more student(s). Roster max is 10 active students.`
            }, { status: 400 });
        }

        // Look up teacher's groups
        const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail: session.email });
        console.log(`[addStudents] teacher=${session.email}, groups=${teacherGroups?.length ?? 0}`);

        const results = [];

        for (const student of students) {
            try {
                // Create Thinkific user with retry on email collision
                const { user, email } = await createThinkificUserWithRetry(student.firstName, student.lastInitial);

                // Create portal access record (source of truth for roster)
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: email.toLowerCase().trim(),
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: session.email
                });

                // Add to every teacher group
                const groupWarnings = [];
                if (!teacherGroups || teacherGroups.length === 0) {
                    groupWarnings.push('No teacher groups found — student created but not added to any group.');
                } else {
                    for (const tg of teacherGroups) {
                        try {
                            await addToGroup(user.id, tg.thinkificGroupId);
                        } catch (groupErr) {
                            groupWarnings.push(`Group ${tg.thinkificGroupId}: ${groupErr.message}`);
                        }
                    }
                }

                // Enroll in bundle
                await enrollInStudentBundle(user.id);

                // Enroll in assignments course + all level courses
                const allCourseIds = [ASSIGNMENTS_COURSE_ID, ...LEVEL_COURSE_IDS];
                await Promise.all(allCourseIds.map(courseId => enrollInCourse(user.id, courseId)));

                const result = {
                    success: true,
                    student: {
                        id: user.id,
                        firstName: student.firstName,
                        lastInitial: student.lastInitial,
                        email: email,
                        password: 'Math1234!'
                    }
                };
                if (groupWarnings.length > 0) result.warnings = groupWarnings;
                results.push(result);

            } catch (error) {
                results.push({
                    success: false,
                    firstName: student.firstName,
                    error: error.message
                });
            }
        }

        return Response.json({ results });

    } catch (error) {
        console.error('Add students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});