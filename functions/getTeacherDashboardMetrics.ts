import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

async function getTeacherGroupsIndex() {
    const allGroups = [];
    let page = 1;
    let hasMoreGroups = true;

    while (hasMoreGroups) {
        const groupsResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/groups?page=${page}&limit=25`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
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
    const CLASSROOM_COURSE_ID = '552235';

    for (const group of allGroups) {
        let membersPage = 1;
        let hasMoreMembers = true;
        while (hasMoreMembers) {
            const membersResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/group_memberships?group_id=${group.id}&page=${membersPage}&limit=25`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
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
                        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}`,
                        {
                            headers: {
                                'X-Auth-API-Key': THINKIFIC_API_KEY,
                                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
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
                    `https://api.thinkific.com/api/public/v1/group_memberships?group_id=${teacherGroup.groupId}&page=${membersPage}&limit=25`,
                    {
                        headers: {
                            'X-Auth-API-Key': THINKIFIC_API_KEY,
                            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
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

function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString();
}

Deno.serve(async (req) => {
    try {
        const { sessionToken } = await req.json();
        const session = await verifySession(sessionToken);
        
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

        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const rosterEvents = allEvents.filter(e => 
            rosterEmails.includes(e.studentEmail?.toLowerCase().trim())
        );

        const quizEvents = rosterEvents.filter(e => 
            e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted'
        );
        const totalQuizAttemptsAllTime = quizEvents.length;

        const weekStart = getWeekStart();
        const now = new Date().toISOString();
        
        const signinEvents = rosterEvents.filter(e => {
            const isSignin = e.eventType === 'user_signin' || e.eventType === 'user.signin';
            const inTimeWindow = e.occurredAt >= weekStart && e.occurredAt <= now;
            return isSignin && inTimeWindow;
        });

        const uniqueStudentsThisWeek = new Set(
            signinEvents.map(e => e.studentEmail?.toLowerCase().trim())
        );
        const activeStudentsThisWeek = uniqueStudentsThisWeek.size;

        return Response.json({
            totalQuizAttemptsAllTime,
            activeStudentsThisWeek
        });

    } catch (error) {
        console.error('Get teacher dashboard metrics error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});