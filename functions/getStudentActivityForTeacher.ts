// 🔒 PRODUCTION LOCKED – DO NOT MODIFY WITHOUT EXPLICIT APPROVAL

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import * as thinkific from './lib/thinkificClient.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function getTeacherStudentEmails(teacherId, teacherEmail) {
    // Get all groups where teacher is a member using Thinkific SDK
    const allGroups = await thinkific.listGroups();
    const students = []; // Now returns {email, id}
    
    for (const group of allGroups) {
        const groupUsers = await thinkific.listGroupUsers(group.id);
        const isMember = groupUsers.some(u => String(u.id) === String(teacherId));
        
        if (isMember) {
            // Include all members EXCEPT the teacher themselves
            groupUsers.forEach(user => {
                if (user.email && String(user.id) !== String(teacherId)) {
                    // Avoid duplicates
                    if (!students.some(s => s.email.toLowerCase() === user.email.toLowerCase())) {
                        students.push({
                            email: user.email.toLowerCase(),
                            id: user.id
                        });
                    }
                }
            });
        }
    }
    
    return students;
}

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken, limit = 5000 } = body;
        
        const session = await verifySession(sessionToken);
        const teacherId = session.userId;
        
        // Get teacher's email for filtering
        const teacherUser = await thinkific.getUser(teacherId);
        
        // Get student roster with emails and IDs (excludes teacher)
        const studentRoster = await getTeacherStudentEmails(teacherId, teacherUser.email);
        const studentEmails = studentRoster.map(s => s.email.toLowerCase());
        const studentIdSet = new Set(studentRoster.map(s => String(s.id)));
        
        // Fetch all activity events sorted by occurredAt (most recent first)
        const base44 = createClientFromRequest(req);
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', 5000);
        
        // Normalize event types for backward compatibility
        const normalizedEvents = allEvents.map(event => {
            let normalizedType = event.eventType;
            if (event.eventType === 'quiz.attempted') normalizedType = 'quiz_attempted';
            if (event.eventType === 'lesson.completed') normalizedType = 'lesson_completed';
            if (event.eventType === 'user.signin') normalizedType = 'user_signin';
            return { ...event, eventType: normalizedType };
        });
        
        // Filter to only events for students in this teacher's roster
        // Match by thinkificUserId (primary, type-safe), then email (fallback)
        const filtered = normalizedEvents
            .filter(e => {
                const eventUserIdStr = e.thinkificUserId != null ? String(e.thinkificUserId) : 
                                       (e.studentUserId != null ? String(e.studentUserId) : '');
                const eventEmail = e.studentEmail?.toLowerCase?.() || '';
                return studentIdSet.has(eventUserIdStr) || studentEmails.includes(eventEmail);
            })
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