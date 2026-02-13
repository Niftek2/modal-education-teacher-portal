import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import * as thinkific from './lib/thinkificClient.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function getTeacherStudentEmails(teacherId) {
    // Get all groups where teacher is a member using Thinkific SDK
    const allGroups = await thinkific.listGroups();
    const studentEmails = new Set();
    
    for (const group of allGroups) {
        const groupUsers = await thinkific.listGroupUsers(group.id);
        const isMember = groupUsers.some(u => String(u.id) === String(teacherId));
        
        if (isMember) {
            // Include all members in teacher's groups
            groupUsers.forEach(user => {
                if (user.email) {
                    studentEmails.add(user.email.toLowerCase());
                }
            });
        }
    }
    
    return Array.from(studentEmails).sort();
}

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken, limit = 50 } = body;
        
        const session = await verifySession(sessionToken);
        const teacherId = session.userId;
        
        // Get student emails in teacher's rosters
        const studentEmails = await getTeacherStudentEmails(teacherId);
        
        // Fetch all activity events
        const base44 = createClientFromRequest(req);
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-created_date', 500);
        
        // Normalize event types for backward compatibility
        const normalizedEvents = allEvents.map(event => {
            let normalizedType = event.eventType;
            if (event.eventType === 'quiz.attempted') normalizedType = 'quiz_attempted';
            if (event.eventType === 'lesson.completed') normalizedType = 'lesson_completed';
            if (event.eventType === 'user.signin') normalizedType = 'user_signin';
            return { ...event, eventType: normalizedType };
        });
        
        // Filter to only events for students in this teacher's roster
        const filtered = normalizedEvents
            .filter(e => studentEmails.includes(e.studentEmail?.toLowerCase()))
            .slice(0, limit);
        
        return Response.json({
            studentEmails,
            events: filtered
        }, { status: 200 });
    } catch (error) {
        console.error('[ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});