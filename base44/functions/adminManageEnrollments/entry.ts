import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { jwtVerify } from 'npm:jose@5.9.6';

const ALLOWED_ADMINS = ['nadiajiftekhar@gmail.com', 'modalmath@gmail.com'];
const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';

const COURSE_IDS = {
    PK: Deno.env.get('PK_COURSE_ID'),
    K: Deno.env.get('K_COURSE_ID'),
    L1: Deno.env.get('L1_COURSE_ID'),
    L2: Deno.env.get('L2_COURSE_ID'),
    L3: Deno.env.get('L3_COURSE_ID'),
    L4: Deno.env.get('L4_COURSE_ID'),
    L5: Deno.env.get('L5_COURSE_ID'),
    Classroom: Deno.env.get('CLASSROOM_COURSE_ID'),
};

const THINKIFIC_HEADERS = {
    'X-Auth-API-Key': Deno.env.get('THINKIFIC_API_KEY') || Deno.env.get('THINKIFIC_API_ACCESS_TOKEN'),
    'X-Auth-Subdomain': Deno.env.get('THINKIFIC_SUBDOMAIN'),
    'Content-Type': 'application/json',
};

async function requireAdminSession(req) {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;
    try {
        const secret = new TextEncoder().encode(Deno.env.get('JWT_SECRET'));
        const { payload } = await jwtVerify(token, secret);
        if (payload.type !== 'session') return null;
        if (!ALLOWED_ADMINS.includes(payload.email?.toLowerCase())) return null;
        return payload;
    } catch { return null; }
}

async function findUserByEmail(email) {
    const res = await fetch(`${THINKIFIC_BASE}/users?query[email]=${encodeURIComponent(email)}`, { headers: THINKIFIC_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0] || null;
}

async function getEnrollments(userId) {
    const res = await fetch(`${THINKIFIC_BASE}/enrollments?query[user_id]=${userId}&limit=50`, { headers: THINKIFIC_HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.items || [];
}

Deno.serve(async (req) => {
    const session = await requireAdminSession(req);
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, studentEmail } = body;

    if (!studentEmail) return Response.json({ error: 'studentEmail required' }, { status: 400 });

    const user = await findUserByEmail(studentEmail);
    if (!user) return Response.json({ error: `No Thinkific user found for ${studentEmail}` }, { status: 404 });

    // GET enrollments
    if (action === 'get') {
        const enrollments = await getEnrollments(user.id);
        const courseIdToLabel = {};
        for (const [label, id] of Object.entries(COURSE_IDS)) {
            if (id) courseIdToLabel[String(id)] = label;
        }

        const result = enrollments.map(e => ({
            enrollmentId: e.id,
            courseId: String(e.course_id),
            courseName: e.course_name,
            label: courseIdToLabel[String(e.course_id)] || null,
            activated: e.activated_at,
            expired: e.expiry_date,
            completed: e.completed_at,
            percentageCompleted: e.percentage_completed,
        }));

        return Response.json({ userId: user.id, enrollments: result, knownCourses: COURSE_IDS });
    }

    // ENROLL in a course
    if (action === 'enroll') {
        const { courseId } = body;
        if (!courseId) return Response.json({ error: 'courseId required' }, { status: 400 });
        const res = await fetch(`${THINKIFIC_BASE}/enrollments`, {
            method: 'POST',
            headers: THINKIFIC_HEADERS,
            body: JSON.stringify({ user_id: user.id, course_id: Number(courseId), activated_at: new Date().toISOString() }),
        });
        const data = await res.json();
        if (!res.ok) return Response.json({ error: `Enroll failed: ${JSON.stringify(data)}` }, { status: res.status });
        return Response.json({ success: true, enrollment: data });
    }

    // UNENROLL from a course (expire the enrollment)
    if (action === 'unenroll') {
        const { enrollmentId } = body;
        if (!enrollmentId) return Response.json({ error: 'enrollmentId required' }, { status: 400 });
        const res = await fetch(`${THINKIFIC_BASE}/enrollments/${enrollmentId}`, {
            method: 'PUT',
            headers: THINKIFIC_HEADERS,
            body: JSON.stringify({ expiry_date: new Date().toISOString() }),
        });
        const data = await res.json();
        if (!res.ok) return Response.json({ error: `Unenroll failed: ${JSON.stringify(data)}` }, { status: res.status });
        return Response.json({ success: true });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
});