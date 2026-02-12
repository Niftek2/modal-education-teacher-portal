import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import * as thinkific from './lib/thinkificClient.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

/**
 * Diagnostic: Teacher Roster & Activity View
 * 
 * Returns:
 * - teacher email, thinkific user_id
 * - entitlement status (enrolled in CLASSROOM_PRODUCT_ID?)
 * - groups found
 * - roster student emails from group membership
 * - last 10 ActivityEvents per student
 */

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken } = body;
        
        const session = await verifySession(sessionToken);
        const teacherEmail = session.email;
        const teacherId = session.userId;
        
        const base44 = createClientFromRequest(req);
        
        const result = {
            timestamp: new Date().toISOString(),
            teacher: {
                email: teacherEmail,
                thinkificUserId: String(teacherId)
            },
            entitlement: {
                courseId: CLASSROOM_PRODUCT_ID,
                enrolled: false,
                enrollmentFound: null
            },
            groups: [],
            rosterStudents: [],
            activitySummary: {}
        };
        
        // 1. Check entitlement
        console.log(`[DIAG] Checking entitlement for user ${teacherId}...`);
        try {
            const enrollments = await thinkific.listEnrollments({
                'query[user_id]': String(teacherId),
                'query[course_id]': CLASSROOM_PRODUCT_ID
            });
            
            if (enrollments.length > 0) {
                result.entitlement.enrolled = true;
                result.entitlement.enrollmentFound = enrollments[0];
            }
        } catch (err) {
            console.error('[DIAG] Entitlement check error:', err.message);
            result.entitlement.error = err.message;
        }
        
        // 2. Discover groups
        console.log(`[DIAG] Discovering groups...`);
        try {
            const allGroups = await thinkific.listGroups();
            
            for (const group of allGroups) {
                const groupUsers = await thinkific.listGroupUsers(group.id);
                const isTeacherMember = groupUsers.some(u => String(u.id) === String(teacherId));
                
                if (isTeacherMember) {
                    result.groups.push({
                        id: String(group.id),
                        name: group.name,
                        memberCount: groupUsers.length
                    });
                    
                    // Collect student emails
                    for (const user of groupUsers) {
                        if (user.email && user.email.toLowerCase().endsWith('@modalmath.com')) {
                            if (!result.rosterStudents.find(s => s.email.toLowerCase() === user.email.toLowerCase())) {
                                result.rosterStudents.push({
                                    thinkificUserId: String(user.id),
                                    email: user.email,
                                    firstName: user.first_name || '',
                                    lastName: user.last_name || ''
                                });
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[DIAG] Group discovery error:', err.message);
            result.groupError = err.message;
        }
        
        // 3. Get activity for each student
        console.log(`[DIAG] Fetching activity for ${result.rosterStudents.length} students...`);
        for (const student of result.rosterStudents) {
            try {
                const events = await base44.asServiceRole.entities.ActivityEvent.filter(
                    { studentEmail: student.email },
                    '-created_date',
                    10
                );
                
                result.activitySummary[student.email] = {
                    eventCount: events.length,
                    lastEvents: events.map(e => ({
                        eventType: e.eventType,
                        contentTitle: e.contentTitle,
                        occurredAt: e.occurredAt,
                        source: e.source
                    }))
                };
            } catch (err) {
                result.activitySummary[student.email] = { error: err.message };
            }
        }
        
        return Response.json(result, { status: 200 });
    } catch (error) {
        console.error('[DIAG] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});