import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireTeacherSession } from './lib/auth.js';
import * as thinkific from './lib/thinkificClient.js';

async function getTeacherStudentEmails(teacherId, teacherEmail) {
    // Get all groups where teacher is a member
    const allGroups = await thinkific.listGroups();
    const studentEmails = new Set();
    const normalizedTeacherEmail = (teacherEmail || '').toLowerCase().trim();
    
    for (const group of allGroups) {
        const groupUsers = await thinkific.listGroupUsers(group.id);
        // Match teacher by email (primary) or Thinkific ID (fallback)
        const isMember = groupUsers.some(u => {
            if (normalizedTeacherEmail && (u.email || '').toLowerCase().trim() === normalizedTeacherEmail) return true;
            if (teacherId && String(u.id) === String(teacherId)) return true;
            return false;
        });
        
        if (isMember) {
            groupUsers.forEach(user => {
                const userEmail = (user.email || '').toLowerCase().trim();
                const isTeacher = userEmail === normalizedTeacherEmail ||
                                  (teacherId && String(user.id) === String(teacherId));
                if (userEmail && !isTeacher) {
                    studentEmails.add(userEmail);
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
        
        const teacherEmail = session.email;
        
        console.log(`[DASHBOARD ACTIVITY] Teacher email: ${teacherEmail}`);
        
        // Always resolve Thinkific ID from email (session may have Base44 userId, not Thinkific userId)
        const found = await thinkific.findUserByEmail(teacherEmail);
        const resolvedTeacherId = found?.id ? String(found.id) : null;
        console.log(`[DASHBOARD ACTIVITY] Resolved Thinkific teacherId: ${resolvedTeacherId}`);
        
        // Get student roster (emails only)
        const studentEmails = await getTeacherStudentEmails(resolvedTeacherId, teacherEmail);
        console.log(`[DASHBOARD ACTIVITY] Found ${studentEmails.length} students:`, studentEmails);
        
        // Fetch all activity events sorted by occurredAt (most recent first)
        const base44 = createClientFromRequest(req);
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', limit);
        console.log(`[DASHBOARD ACTIVITY] Fetched ${allEvents.length} total events`);
        
        // Filter to only events for students in this teacher's roster
        const filtered = allEvents
            .filter(e => {
                const eventEmail = (e.studentEmail || '').toLowerCase().trim();
                const matches = studentEmails.includes(eventEmail);
                if (eventEmail === 'azizae414@modalmath.com') {
                    console.log(`[DASHBOARD ACTIVITY] Found Aziza event: ${e.eventType}, matches roster: ${matches}`);
                }
                return matches;
            })
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
        
        console.log(`[DASHBOARD ACTIVITY] Returning ${filtered.length} filtered events`);
        const azizaEvents = filtered.filter(e => (e.studentEmail || '').toLowerCase().trim() === 'azizae414@modalmath.com');
        console.log(`[DASHBOARD ACTIVITY] Aziza events in result: ${azizaEvents.length}`);
        
        return Response.json({
            studentEmails,
            events: filtered
        }, { status: 200 });
    } catch (error) {
        console.error('[DASHBOARD ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});