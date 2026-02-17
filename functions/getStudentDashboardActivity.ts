import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';
import * as thinkific from './lib/thinkificClient.js';

async function getTeacherStudentEmails(teacherId, teacherEmail) {
    // Get all groups where teacher is a member
    const allGroups = await thinkific.listGroups();
    const studentEmails = new Set();
    
    for (const group of allGroups) {
        const groupUsers = await thinkific.listGroupUsers(group.id);
        const isMember = groupUsers.some(u => String(u.id) === String(teacherId));
        
        if (isMember) {
            groupUsers.forEach(user => {
                if (user.email && String(user.id) !== String(teacherId)) {
                    studentEmails.add(user.email.toLowerCase().trim());
                }
            });
        }
    }
    
    return Array.from(studentEmails);
}

function normalizeEventType(eventType) {
    // Support backward compatibility: treat both formats as same event
    const aliasMap = {
        'quiz.attempted': 'quiz_attempted',
        'lesson.completed': 'lesson_completed',
        'user.signin': 'user_signin',
        'user.signup': 'user_signup',
        'enrollment.created': 'enrollment_created'
    };
    
    return aliasMap[eventType] || eventType;
}

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { limit = 5000 } = body;
        
        const teacherId = session.userId;
        
        const teacherUser = await thinkific.getUser(teacherId);
        
        // Get student roster (emails only)
        const studentEmails = await getTeacherStudentEmails(teacherId, teacherUser.email);
        
        // Fetch all activity events sorted by occurredAt (most recent first)
        const base44 = createClientFromRequest(req);
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', limit);
        
        // Filter to only events for students in this teacher's roster
        const filtered = allEvents
            .filter(e => studentEmails.includes((e.studentEmail || '').toLowerCase().trim()))
            .map(e => {
                // Normalize eventType for backward compatibility
                const normalizedEventType = normalizeEventType(e.eventType);
                
                // Compute display grade for quiz attempts with robust fallbacks
                let displayGrade = (typeof e.grade === 'number') ? e.grade : null;

                if (normalizedEventType === 'quiz_attempted' && displayGrade == null) {
                    // 1) Prefer canonical stored field from webhook handler
                    if (typeof e.scorePercent === 'number') {
                        displayGrade = e.scorePercent;
                    }

                    // 2) Fallback: older/alternate storage in metadata
                    if (displayGrade == null && e.metadata && typeof e.metadata.scorePercent === 'number') {
                        displayGrade = e.metadata.scorePercent;
                    }

                    // 3) Fallback: rawPayload may be either:
                    //    a) payload object itself (current webhook saves JSON.stringify(payload))
                    //    b) wrapper object { payload: {...} } (older code path assumption)
                    if (displayGrade == null && e.rawPayload) {
                        try {
                            const rawData = JSON.parse(e.rawPayload);
                            const maybePayload = rawData?.payload ? rawData.payload : rawData;
                            const payloadGrade = maybePayload?.grade;
                            if (typeof payloadGrade === 'number') {
                                displayGrade = payloadGrade <= 1 ? payloadGrade * 100 : payloadGrade;
                            }
                        } catch {}
                    }
                }
                
                return {
                    ...e,
                    eventType: normalizedEventType,
                    grade: displayGrade
                };
            })
            .slice(0, limit);
        
        return Response.json({
            studentEmails,
            events: filtered
        }, { status: 200 });
    } catch (error) {
        console.error('[DASHBOARD ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});