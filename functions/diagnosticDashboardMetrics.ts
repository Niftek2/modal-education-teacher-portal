import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function getTeacherGroupMemberships(thinkificUserId) {
    const response = await fetch(
        `https://api.thinkific.com/api/public/v1/group_memberships?user_id=${thinkificUserId}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        }
    );

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return data.items || [];
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

        const { teacherEmail } = await req.json();
        const targetEmail = teacherEmail || user.email;

        // Get teacher's Thinkific user ID
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(targetEmail)}`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch teacher data');
        }

        const userData = await response.json();
        const teacher = userData.items?.[0];
        
        if (!teacher) {
            throw new Error('Teacher not found');
        }

        // Get all groups teacher belongs to
        const groupMemberships = await getTeacherGroupMemberships(teacher.id);
        const groupIds = groupMemberships.map(m => m.group_id);

        // Get roster
        const rosterEmailsSet = new Set();
        
        for (const groupId of groupIds) {
            const groupResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/group_memberships?group_id=${groupId}`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                    }
                }
            );

            if (groupResponse.ok) {
                const groupData = await groupResponse.json();
                const members = groupData.items || [];
                
                for (const member of members) {
                    const email = member.user?.email;
                    if (email && email.toLowerCase().trim().endsWith('@modalmath.com')) {
                        rosterEmailsSet.add(email.toLowerCase().trim());
                    }
                }
            }
        }

        const rosterEmails = Array.from(rosterEmailsSet);
        const weekStart = getWeekStart();
        const now = new Date().toISOString();

        // Get activity events
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const rosterEvents = allEvents.filter(e => 
            rosterEmails.includes(e.studentEmail?.toLowerCase().trim())
        );

        // Quiz attempts
        const quizEvents = rosterEvents.filter(e => 
            e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted'
        );
        const totalQuizAttemptsAllTime = quizEvents.length;

        // Active students this week
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
            teacherEmail: targetEmail,
            groupIds,
            rosterEmailsCount: rosterEmails.length,
            rosterEmailsSample: rosterEmails.slice(0, 5),
            weekStart,
            totalQuizAttemptsAllTime,
            activeStudentsThisWeek,
            debug: {
                totalEvents: allEvents.length,
                rosterEvents: rosterEvents.length,
                quizEvents: quizEvents.length,
                signinEventsThisWeek: signinEvents.length
            }
        });

    } catch (error) {
        console.error('Diagnostic dashboard metrics error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});