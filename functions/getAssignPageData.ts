import { requireSession } from './lib/auth.js';

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");
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

async function isEnrolledInClassroom(userId) {
    const data = await thinkificGet('/enrollments', {
        'query[user_id]': String(userId),
        'query[course_id]': String(CLASSROOM_PRODUCT_ID)
    });
    const items = data.items || [];
    return items.length > 0;
}

Deno.serve(async (req) => {
    const session = await requireSession(req);
    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const teacherId = session.userId;
        const teacherEmail = session.email?.toLowerCase().trim();

        console.log(`[getAssignPageData] Teacher: ${teacherId} / ${teacherEmail}`);
        console.log(`[getAssignPageData] CLASSROOM_PRODUCT_ID: ${CLASSROOM_PRODUCT_ID}`);

        // Verify teacher is enrolled in 'Your Classroom'
        const isTeacher = await isEnrolledInClassroom(teacherId);
        if (!isTeacher) {
            return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
        }

        // Get all groups, find ones this teacher belongs to
        const groupsData = await thinkificGet('/groups');
        const allGroups = groupsData.items || [];
        console.log(`[getAssignPageData] Total groups: ${allGroups.length}`);

        const studentEmailsSet = new Set();

        for (const group of allGroups) {
            const groupUsersData = await thinkificGet('/group_users', { 'query[group_id]': String(group.id) });
            const groupUsers = groupUsersData.items || [];
            const teacherInGroup = groupUsers.some(u => String(u.id) === String(teacherId));

            if (!teacherInGroup) continue;

            console.log(`[getAssignPageData] Teacher in group: ${group.name} (${group.id}), members: ${groupUsers.length}`);

            for (const user of groupUsers) {
                const email = user.email?.toLowerCase().trim();
                if (!email) continue;
                if (String(user.id) === String(teacherId)) continue;
                if (!email.endsWith('@modalmath.com')) continue;

                // Exclude other teachers enrolled in Classroom
                const alsoTeacher = await isEnrolledInClassroom(user.id);
                if (alsoTeacher) {
                    console.log(`[getAssignPageData] Excluding ${email} (also a teacher)`);
                    continue;
                }

                studentEmailsSet.add(email);
            }
        }

        const studentEmails = Array.from(studentEmailsSet).sort();
        console.log(`[getAssignPageData] Final roster (${studentEmails.length}):`, studentEmails);

        return Response.json({ success: true, studentEmails }, { status: 200 });

    } catch (error) {
        console.error('[getAssignPageData] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});