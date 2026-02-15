import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

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

    let groupsScannedCount = allGroups.length;
    let totalTeacherCandidatesFound = 0;
    let validTeachersFound = 0;

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
                    totalTeacherCandidatesFound++;
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
                    const hasClassroomEnrollment = enrollmentsData.items?.some(e => String(e.course_id) === CLASSROOM_COURSE_ID && e.status === 'active');

                    if (hasClassroomEnrollment) {
                        validTeachersFound++;
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
    return {
        teacherGroupsIndex,
        groupsScannedCount,
        totalTeacherCandidatesFound,
        validTeachersFound
    };
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
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { teacherEmail: requestedTeacherEmail } = await req.json();
        const sessionEmail = user.email.toLowerCase().trim();
        const targetEmail = requestedTeacherEmail?.toLowerCase().trim() || sessionEmail;

        const { teacherGroupsIndex, groupsScannedCount, totalTeacherCandidatesFound, validTeachersFound } = await getTeacherGroupsIndex();

        const sessionTeacherGroups = teacherGroupsIndex.get(targetEmail);

        const rosterEmailsSet = new Set();
        const groupIds = [];
        if (sessionTeacherGroups) {
            for (const group of sessionTeacherGroups) {
                groupIds.push(group.groupId);
                group.studentEmails.forEach(email => rosterEmailsSet.add(email));
            }
        }
        const rosterEmails = Array.from(rosterEmailsSet);
        const weekStart = getWeekStart();
        const now = new Date().toISOString();

        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const rosterEvents = allEvents.filter(e => 
            rosterEmails.includes(e.studentEmail?.toLowerCase().trim())
        );

        const quizEvents = rosterEvents.filter(e => 
            e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted'
        );
        const totalQuizAttemptsAllTime = quizEvents.length;

        const signinEvents = rosterEvents.filter(e => {
            const isSignin = e.eventType === 'user_signin' || e.eventType === 'user.signin';
            const inTimeWindow = e.occurredAt >= weekStart && e.occurredAt <= now;
            return isSignin && inTimeWindow;
        });

        const uniqueStudentsThisWeek = new Set(
            signinEvents.map(e => e.studentEmail?.toLowerCase().trim())
        );
        const activeStudentsThisWeek = uniqueStudentsThisWeek.size;

        const top5RecentEventsSample = rosterEvents
            .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
            .slice(0, 5)
            .map(e => ({
                studentEmail: e.studentEmail,
                eventType: e.eventType,
                occurredAt: e.occurredAt
            }));

        return Response.json({
            sessionEmail,
            targetEmail,
            groupsScannedCount,
            totalTeacherCandidatesFound,
            validTeachersFound,
            teacherGroupsIndexKeys: Array.from(teacherGroupsIndex.keys()).slice(0, 50),
            sessionTeacherGroups: sessionTeacherGroups ? sessionTeacherGroups.map(g => ({
                groupId: g.groupId,
                groupName: g.groupName,
                studentCount: g.studentEmails.length
            })) : [],
            rosterEmailsCount: rosterEmails.length,
            rosterEmailsSample: rosterEmails.slice(0, 5),
            weekStart,
            quizAttemptCount: totalQuizAttemptsAllTime,
            activeThisWeekDistinctStudents: activeStudentsThisWeek,
            debug: {
                totalEvents: allEvents.length,
                rosterEvents: rosterEvents.length,
                quizEvents: quizEvents.length,
                signinEventsThisWeek: signinEvents.length,
                top5RecentEventsSample
            }
        });

    } catch (error) {
        console.error('Diagnostic dashboard metrics error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});