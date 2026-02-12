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
            config: {
                restBase: 'https://api.thinkific.com/api/public/v1',
                graphqlEndpoint: 'https://api.thinkific.com/stable/graphql'
            },
            teacher: {
                email: teacherEmail,
                thinkificUserId: String(teacherId)
            },
            httpCalls: [],
            entitlement: {
                courseId: CLASSROOM_PRODUCT_ID,
                enrolled: false,
                httpStatus: null
            },
            groupDiscovery: {
                httpStatus: null,
                groupsFound: 0
            },
            groupUserCalls: [],
            rosterStudents: [],
            activitySummary: {}
        };
        
        // 1. Check entitlement (enrollments call)
        console.log(`[DIAG] Calling GET /enrollments?query[user_id]=${teacherId}&query[course_id]=${CLASSROOM_PRODUCT_ID}`);
        try {
            const enrollments = await thinkific.listEnrollments({
                'query[user_id]': String(teacherId),
                'query[course_id]': CLASSROOM_PRODUCT_ID
            });
            
            result.entitlement.httpStatus = 200;
            result.httpCalls.push({
                method: 'GET',
                path: '/enrollments',
                query: `user_id=${teacherId}&course_id=${CLASSROOM_PRODUCT_ID}`,
                status: 200,
                resultCount: enrollments.length
            });
            
            if (enrollments.length > 0) {
                result.entitlement.enrolled = true;
                result.entitlement.enrollmentFound = {
                    id: enrollments[0].id,
                    activatedAt: enrollments[0].activated_at,
                    expired: enrollments[0].expired
                };
            }
        } catch (err) {
            result.entitlement.httpStatus = 'ERROR';
            result.entitlement.error = err.message;
            result.httpCalls.push({
                method: 'GET',
                path: '/enrollments',
                query: `user_id=${teacherId}&course_id=${CLASSROOM_PRODUCT_ID}`,
                status: 'ERROR',
                error: err.message
            });
        }
        
        // 2. List groups
        console.log(`[DIAG] Calling GET /groups`);
        try {
            const allGroups = await thinkific.listGroups();
            
            result.groupDiscovery.httpStatus = 200;
            result.groupDiscovery.groupsFound = allGroups.length;
            result.httpCalls.push({
                method: 'GET',
                path: '/groups',
                status: 200,
                resultCount: allGroups.length
            });
            
            // 3. For each group, get members
            for (const group of allGroups) {
                console.log(`[DIAG] Calling GET /group_users?query[group_id]=${group.id}`);
                try {
                    const groupUsers = await thinkific.listGroupUsers(group.id);
                    const isTeacherMember = groupUsers.some(u => String(u.id) === String(teacherId));
                    
                    result.groupUserCalls.push({
                        groupId: String(group.id),
                        groupName: group.name,
                        method: 'GET',
                        path: '/users',
                        query: `group_id=${group.id}`,
                        status: 200,
                        memberCount: groupUsers.length,
                        teacherIsMember: isTeacherMember
                    });
                    
                    if (isTeacherMember) {
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
                } catch (err) {
                    result.groupUserCalls.push({
                        groupId: String(group.id),
                        groupName: group.name,
                        method: 'GET',
                        path: '/users',
                        query: `group_id=${group.id}`,
                        status: 'ERROR',
                        error: err.message
                    });
                }
            }
        } catch (err) {
            result.groupDiscovery.httpStatus = 'ERROR';
            result.groupDiscovery.error = err.message;
            result.httpCalls.push({
                method: 'GET',
                path: '/groups',
                status: 'ERROR',
                error: err.message
            });
        }
        
        // 4. Get activity for each student
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
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});