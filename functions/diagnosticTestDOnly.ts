/**
 * Focused Test D: archive a freshly-created student and verify post-archive state.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY     = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN   = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const STUDENT_PRODUCT_ID    = Deno.env.get("STUDENT_PRODUCT_ID");

const ASSIGNMENTS_COURSE_ID = '3359727';
const LEVEL_COURSE_IDS = ['422595', '422618', '422620', '496294', '496295', '496297', '496298'];
const ALL_COURSE_IDS = [ASSIGNMENTS_COURSE_ID, ...LEVEL_COURSE_IDS];

const tkKeyHeaders = {
    'X-Auth-API-Key': THINKIFIC_API_KEY,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json'
};
const tkBearerHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json'
};

async function tkFetch(path, opts = {}) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1${path}`, opts);
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Thinkific ${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`);
    return body;
}

async function findUserByEmail(email) {
    const data = await tkFetch(`/users?query[email]=${encodeURIComponent(email)}`, { headers: tkBearerHeaders });
    return data?.items?.[0] || null;
}

async function getUserEnrollments(userId) {
    const data = await tkFetch(`/enrollments?query[user_id]=${userId}&limit=100`, { headers: tkBearerHeaders });
    return data?.items || [];
}

async function createUser(email) {
    return tkFetch('/users', {
        method: 'POST', headers: tkKeyHeaders,
        body: JSON.stringify({ first_name: 'ArchTest', last_name: 'D', email, password: 'Math1234!', send_welcome_email: false })
    });
}

async function enrollInCourse(userId, courseId) {
    try {
        await tkFetch('/enrollments', {
            method: 'POST', headers: tkKeyHeaders,
            body: JSON.stringify({ user_id: userId, course_id: courseId, activated_at: new Date().toISOString() })
        });
        return 'OK';
    } catch (e) { return `FAILED: ${e.message}`; }
}

async function deleteEnrollment(enrollmentId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollmentId}`, {
        method: 'DELETE', headers: tkKeyHeaders
    });
    return res.status === 204 || res.status === 404 || res.ok;
}

async function deleteUser(userId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        method: 'DELETE', headers: tkKeyHeaders
    });
    return res.status;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const testEmail = `archtestd_${Date.now()}@modalmath.com`;

        // Step 1: Create user
        console.log(`Creating test user: ${testEmail}`);
        const user = await createUser(testEmail);
        const userId = user.id;
        console.log(`Created user id=${userId}`);

        // Step 2: Enroll in all courses
        const enrollSetup = await Promise.all(ALL_COURSE_IDS.map(cid => enrollInCourse(userId, cid)));
        console.log('Enrollment setup:', JSON.stringify(enrollSetup));

        // Step 3: Verify pre-archive enrollments
        await new Promise(r => setTimeout(r, 800));
        const enrollsBefore = await getUserEnrollments(userId);
        const enrolledBefore = enrollsBefore.map(e => String(e.course_id));
        console.log('Enrolled before archive:', enrolledBefore);

        // Step 4: Simulate archive — create ArchivedStudent, unenroll PK-L5 only
        await base44.asServiceRole.entities.ArchivedStudent.create({
            studentThinkificUserId: String(userId),
            studentEmail: testEmail,
            groupId: 'test_unknown',
            teacherThinkificUserId: 'test_teacher',
            archivedAt: new Date().toISOString()
        });

        // Unenroll PK-L5
        const toUnenroll = enrollsBefore.filter(e => LEVEL_COURSE_IDS.includes(String(e.course_id)));
        const unenrollResults = [];
        for (const e of toUnenroll) {
            const ok = await deleteEnrollment(e.id);
            unenrollResults.push({ courseId: String(e.course_id), enrollmentId: e.id, deleted: ok });
        }
        console.log('Unenroll results:', JSON.stringify(unenrollResults));

        // Step 5: Verify post-archive state
        await new Promise(r => setTimeout(r, 1000));
        const enrollsAfter = await getUserEnrollments(userId);
        const enrolledAfter = enrollsAfter.map(e => String(e.course_id));
        console.log('Enrolled after archive:', enrolledAfter);

        const levelResults = LEVEL_COURSE_IDS.map(cid => ({
            courseId: cid,
            removed: !enrolledAfter.includes(cid)
        }));
        const allLevelsRemoved = levelResults.every(r => r.removed);
        const assignmentsStillEnrolled = enrolledAfter.includes(ASSIGNMENTS_COURSE_ID);

        const userAfter = await findUserByEmail(testEmail);
        const userStillExists = !!userAfter?.id;

        const archivedRecs = await base44.asServiceRole.entities.ArchivedStudent.filter({ studentEmail: testEmail });
        const archivedInDB = archivedRecs.length > 0;

        const PASS = allLevelsRemoved && assignmentsStillEnrolled && userStillExists && archivedInDB;
        console.log(`Test D PASS: ${PASS}`);

        // Cleanup
        await deleteUser(userId);
        for (const a of archivedRecs) await base44.asServiceRole.entities.ArchivedStudent.delete(a.id);
        const codes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: testEmail });
        for (const c of codes) await base44.asServiceRole.entities.StudentAccessCode.delete(c.id);
        console.log('Cleanup done');

        const result = {
            PASS,
            thinkificUserId: userId,
            studentEmail: testEmail,
            enrolledBeforeArchive: enrolledBefore,
            unenrollResults,
            enrolledAfterArchive: enrolledAfter,
            levelResults,
            allLevelEnrollmentsRemoved: allLevelsRemoved,
            assignmentsCourse3359727StillEnrolled: assignmentsStillEnrolled,
            thinkificUserStillExists: userStillExists,
            archivedStudentRecordInDB: archivedInDB
        };
        console.log('=== TEST D RESULT ===');
        console.log(JSON.stringify(result, null, 2));
        return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error('Test D error:', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});