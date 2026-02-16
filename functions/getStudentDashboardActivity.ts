import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import * as thinkific from './lib/thinkificClient.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function getTeacherStudentIds(teacherId, teacherEmail) {
    // Get all groups where teacher is a member
    const allGroups = await thinkific.listGroups();
    const studentIds = new Set();
    
    for (const group of allGroups) {
        const groupUsers = await thinkific.listGroupUsers(group.id);
        const isMember = groupUsers.some(u => String(u.id) === String(teacherId));
        
        if (isMember) {
            groupUsers.forEach(user => {
                if (user.id && String(user.id) !== String(teacherId)) {
                    studentIds.add(user.id);
                }
            });
        }
    }
    
    return Array.from(studentIds);
}

function normalizeEventType(eventType) {
    // Support backward compatibility: convert underscore to dot style
    const aliasMap = {
        'quiz_attempted': 'quiz.attempted',
        'lesson_completed': 'lesson.completed',
        'user_signin': 'user.signin',
        'user_signup': 'user.signup',
        'enrollment_created': 'enrollment.created'
    };
    
    return aliasMap[eventType] || eventType;
}

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken, limit = 5000 } = body;
        
        const session = await verifySession(sessionToken);
        const teacherId = session.userId;
        
        const teacherUser = await thinkific.getUser(teacherId);
        
        // Get student roster (thinkificUserId only)
        const studentIds = await getTeacherStudentIds(teacherId, teacherUser.email);
        
        // Fetch all activity events sorted by occurredAt (most recent first)
        const base44 = createClientFromRequest(req);
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', limit);
        
        // Filter to only events for students in this teacher's roster
        const filtered = allEvents
            .filter(e => studentIds.includes(e.thinkificUserId))
            .map(e => ({
                ...e,
                // Apply eventType aliasing for backward compatibility
                eventType: normalizeEventType(e.eventType)
            }))
            .slice(0, limit);
        
        return Response.json({
            studentIds,
            events: filtered
        }, { status: 200 });
    } catch (error) {
        console.error('[DASHBOARD ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});