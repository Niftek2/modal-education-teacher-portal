import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

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

const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

async function getTeacherGroupsIndex() {
    const allGroups = [];
    let page = 1;
    let hasMoreGroups = true;

    while (hasMoreGroups) {
        const groupsResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/groups?page=${page}&limit=25`,
            {
                headers: {
                    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!groupsResponse.ok) {
            console.error('Failed to fetch groups:', await groupsResponse.text());
            throw new Error('Failed to fetch groups');
        }

        const groupsData = await groupsResponse.json();
        allGroups.push(...groupsData.items);
        hasMoreGroups = groupsData.meta.pagination.current_page < groupsData.meta.pagination.total_pages;
        page++;
    }

    const validTeachersByEmail = new Map();
    const CLASSROOM_COURSE_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");

    for (const group of allGroups) {
        let membersPage = 1;
        let hasMoreMembers = true;
        while (hasMoreMembers) {
            const membersResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/group_users?query[group_id]=${group.id}&page=${membersPage}&limit=25`,
                {
                    headers: {
                        'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!membersResponse.ok) {
                console.warn(`Failed to fetch members for group ${group.id}:`, await membersResponse.text());
                break;
            }

            const membersData = await membersResponse.json();
            for (const member of membersData.items) {
                const email = member.user?.email?.toLowerCase().trim();
                const userId = String(member.user?.id);

                if (!email || !userId) continue;

                if (!email.endsWith('@modalmath.com')) {
                    const enrollmentsResponse = await fetch(
                        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${CLASSROOM_COURSE_ID}&limit=1`,
                        {
                            headers: {
                                'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    const enrollmentsData = await enrollmentsResponse.json();
                    const hasClassroomEnrollment = enrollmentsData.items?.some(e => String(e.course_id) === CLASSROOM_COURSE_ID);

                    if (hasClassroomEnrollment) {
                        if (!validTeachersByEmail.has(email)) {
                            validTeachersByEmail.set(email, { userId, groups: [] });
                        }
                        validTeachersByEmail.get(email).groups.push({ groupId: group.id, groupName: group.name });
                    }
                }
            }
            hasMoreMembers = membersData.meta.pagination.current_page < membersData.meta.pagination.total_pages;
            membersPage++;
        }
    }

    const teacherGroupsIndex = new Map();

    for (const [teacherEmail, teacherInfo] of validTeachersByEmail.entries()) {
        const teacherGroups = [];
        for (const teacherGroup of teacherInfo.groups) {
            const studentEmails = new Set();
            let membersPage = 1;
            let hasMoreMembers = true;
            while (hasMoreMembers) {
                const membersResponse = await fetch(
                    `https://api.thinkific.com/api/public/v1/group_users?query[group_id]=${teacherGroup.groupId}&page=${membersPage}&limit=25`,
                    {
                        headers: {
                            'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                if (!membersResponse.ok) {
                    console.warn(`Failed to fetch members for group ${teacherGroup.groupId}:`, await membersResponse.text());
                    break;
                }

                const membersData = await membersResponse.json();
                for (const member of membersData.items) {
                    const email = member.user?.email?.toLowerCase().trim();
                    if (email && email.endsWith('@modalmath.com')) {
                        studentEmails.add(email);
                    }
                }
                hasMoreMembers = membersData.meta.pagination.current_page < membersData.meta.pagination.total_pages;
                membersPage++;
            }
            teacherGroups.push({ ...teacherGroup, studentEmails: Array.from(studentEmails) });
        }
        teacherGroupsIndex.set(teacherEmail, teacherGroups);
    }
    return teacherGroupsIndex;
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);

        const teacherGroupsIndex = await getTeacherGroupsIndex();
        const teacherEmail = session.email.toLowerCase().trim();
        const teacherGroups = teacherGroupsIndex.get(teacherEmail);

        if (!teacherGroups || teacherGroups.length === 0) {
            return Response.json({
                totalQuizAttemptsAllTime: 0,
                activeStudentsThisWeek: 0,
                error: 'Teacher not found in any group with Classroom entitlement.'
            });
        }

        const rosterEmailsSet = new Set();
        for (const group of teacherGroups) {
            group.studentEmails.forEach(email => rosterEmailsSet.add(email));
        }
        const rosterEmails = Array.from(rosterEmailsSet);

        if (rosterEmails.length === 0) {
            return Response.json({
                totalQuizAttemptsAllTime: 0,
                activeStudentsThisWeek: 0
            });
        }

        // Targeted DB-level filter — only fetch events for this teacher's students
        const rosterEvents = await base44.asServiceRole.entities.ActivityEvent.filter({
            studentEmail: { _in: rosterEmails }
        });

        const quizEvents = rosterEvents.filter(e =>
            e.eventType === 'quiz.attempted' || e.eventType === 'quiz_attempted'
        );

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const sevenDaysAgoISO = sevenDaysAgo.toISOString();

        const recentSignins = rosterEvents.filter(e => {
            const isSignin = e.eventType === 'user_signin' || e.eventType === 'user.signin';
            return isSignin && e.occurredAt >= sevenDaysAgoISO;
        });

        const activeStudentsThisWeek = new Set(
            recentSignins.map(e => e.studentEmail?.toLowerCase().trim())
        ).size;

        return Response.json({
            totalQuizAttemptsAllTime: quizEvents.length,
            activeStudentsThisWeek
        });

    } catch (error) {
        console.error('Get teacher dashboard metrics error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});