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
        throw new Error('Failed to fetch teacher groups');
    }

    const data = await response.json();
    return data.items || [];
}

function getWeekStart() {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
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

        // Get teacher's Thinkific user ID
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(session.email)}`,
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

        // Get roster: all students in those groups (email ends with @modalmath.com)
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

        if (rosterEmails.length === 0) {
            return Response.json({
                totalQuizAttemptsAllTime: 0,
                activeStudentsThisWeek: 0
            });
        }

        // Get all activity events for roster students
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.filter({});
        const rosterEvents = allEvents.filter(e => 
            rosterEmails.includes(e.studentEmail?.toLowerCase().trim())
        );

        // Count quiz attempts (all time)
        const quizEvents = rosterEvents.filter(e => 
            e.eventType === 'quiz_attempted' || e.eventType === 'quiz.attempted'
        );
        const totalQuizAttemptsAllTime = quizEvents.length;

        // Count unique students who signed in this week
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