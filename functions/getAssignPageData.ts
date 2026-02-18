import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID"); // "552235"
const REST_BASE = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/api/public/v1`;

async function thinkificGet(path, queryParams = {}) {
    const url = new URL(`${REST_BASE}${path}`);
    Object.entries(queryParams).forEach(([k, v]) => url.searchParams.append(k, v));
    const res = await fetch(url.toString(), {
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Thinkific ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
}

async function findUserByEmail(email) {
    const data = await thinkificGet('/users', { 'query[email]': email });
    const items = data.items || [];
    return items.length > 0 ? items[0] : null;
}

async function getUserEnrollments(userId) {
    const data = await thinkificGet('/enrollments', { 'query[user_id]': String(userId) });
    return data.items || [];
}

async function isEnrolledInClassroom(userId) {
    const enrollments = await getUserEnrollments(userId);
    return enrollments.some(e =>
        String(e.course_id) === String(CLASSROOM_PRODUCT_ID) &&
        (e.activated_at || e.percentage_completed !== undefined)
    );
}

async function listGroups() {
    const data = await thinkificGet('/groups');
    return data.items || [];
}

async function listGroupUsers(groupId) {
    const data = await thinkificGet('/group_users', { 'query[group_id]': String(groupId) });
    return data.items || [];
}

Deno.serve(async (req) => {
    const session = await requireSession(req);
    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const teacherEmail = session.email?.toLowerCase().trim();
        const teacherId = session.userId;

        console.log(`[ASSIGN PAGE DATA] Teacher: ${teacherId}, ${teacherEmail}`);

        // Rule 2: Verify teacher is enrolled in 'Your Classroom' (course 552235)
        const isTeacher = await isEnrolledInClassroom(teacherId);
        console.log(`[ASSIGN PAGE DATA] Is teacher: ${isTeacher}`);
        if (!isTeacher) {
            return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
        }

        // Rule 3: Find all groups teacher belongs to, collect @modalmath.com students
        const allGroups = await listGroups();
        console.log(`[ASSIGN PAGE DATA] Total groups: ${allGroups.length}`);

        const studentEmailsSet = new Set();

        for (const group of allGroups) {
            const groupUsers = await listGroupUsers(group.id);
            const teacherInGroup = groupUsers.some(u => String(u.id) === String(teacherId));

            if (teacherInGroup) {
                console.log(`[ASSIGN PAGE DATA] Teacher is in group: ${group.name} (${group.id}), members: ${groupUsers.length}`);
                for (const user of groupUsers) {
                    const email = user.email?.toLowerCase().trim();
                    if (!email) continue;
                    if (String(user.id) === String(teacherId)) continue; // exclude self
                    if (!email.endsWith('@modalmath.com')) continue;     // Rule 3: @modalmath.com only

                    // Rule 3: Exclude users also enrolled in 'Your Classroom' (other teachers)
                    const alsoTeacher = await isEnrolledInClassroom(user.id);
                    if (!alsoTeacher) {
                        studentEmailsSet.add(email);
                    } else {
                        console.log(`[ASSIGN PAGE DATA] Excluding ${email} (also a teacher)`);
                    }
                }
            }
        }

        const studentEmails = Array.from(studentEmailsSet).sort();
        console.log(`[ASSIGN PAGE DATA] Final student roster (${studentEmails.length}):`, studentEmails);

        return Response.json({ success: true, studentEmails }, { status: 200 });

    } catch (error) {
        console.error('[ASSIGN PAGE DATA] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});