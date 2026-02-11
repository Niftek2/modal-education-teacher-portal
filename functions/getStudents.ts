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

async function getGroupMembers(groupId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_users?query[group_id]=${groupId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Get group users error:', response.status, errorText);
        throw new Error(`Failed to fetch group members: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
}

async function getUserProgress(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/course_progresses?query[user_id]=${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        return { percentage: 0, lastActivity: null };
    }

    const data = await response.json();
    const progresses = data.items || [];
    
    if (progresses.length === 0) {
        return { percentage: 0, lastActivity: null };
    }

    const avgProgress = progresses.reduce((sum, p) => sum + (p.percentage_completed || 0), 0) / progresses.length;
    const latestActivity = progresses
        .map(p => p.updated_at)
        .filter(Boolean)
        .sort()
        .reverse()[0];

    return {
        percentage: Math.round(avgProgress),
        lastActivity: latestActivity,
        completedLessons: progresses.reduce((sum, p) => sum + (p.completed_chapters || 0), 0)
    };
}

Deno.serve(async (req) => {
    try {
        const { groupId, sessionToken } = await req.json();
        await verifySession(sessionToken);

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        // Get group members
        const memberships = await getGroupMembers(groupId);
        
        // Extract user data from memberships and filter by email domain
        const students = memberships
            .filter(m => m.user?.email?.toLowerCase().endsWith('@modalmath.com'))
            .map(m => m.user);

        // Get progress for each student
        const studentsWithProgress = await Promise.all(
            students.map(async (student) => {
                const progress = await getUserProgress(student.id);
                return {
                    id: student.id,
                    firstName: student.first_name,
                    lastName: student.last_name,
                    email: student.email,
                    ...progress
                };
            })
        );

        return Response.json({ students: studentsWithProgress });

    } catch (error) {
        console.error('Get students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});