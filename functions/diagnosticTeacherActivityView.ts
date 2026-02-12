import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';
import * as thinkific from './lib/thinkificClient.js';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

/**
 * Teacher Activity View Diagnostic
 * 
 * For a given teacher, shows:
 * - Groups they belong to
 * - Student rosters in those groups
 * - For one student email: enrollments and last 10 activity events
 * - Backfill capabilities assessment
 */

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken, studentEmailToDetail } = body;
        
        const session = await verifySession(sessionToken);
        const teacherEmail = session.email;
        const teacherId = session.userId;
        
        console.log(`[DIAG] Teacher activity view for ${teacherEmail} (ID: ${teacherId})`);
        
        const diagnostic = {
            teacher: {
                email: teacherEmail,
                thinkificUserId: String(teacherId)
            },
            groups: [],
            studentRoster: [],
            selectedStudent: null,
            enrollments: [],
            recentActivity: [],
            backfillCapabilities: {}
        };
        
        // 1. Find teacher's groups
        console.log('[DIAG] Fetching groups...');
        const allGroups = await thinkific.listGroups();
        
        for (const group of allGroups) {
            const groupUsers = await thinkific.listGroupUsers(group.id);
            const isTeacherMember = groupUsers.some(u => String(u.id) === String(teacherId));
            
            if (isTeacherMember) {
                diagnostic.groups.push({
                    id: String(group.id),
                    name: group.name,
                    memberCount: groupUsers.length
                });
                
                // Collect students in this group
                groupUsers.forEach(user => {
                    if (user.email && user.email.toLowerCase().endsWith('@modalmath.com')) {
                        if (!diagnostic.studentRoster.find(s => s.email.toLowerCase() === user.email.toLowerCase())) {
                            diagnostic.studentRoster.push({
                                thinkificUserId: String(user.id),
                                email: user.email,
                                firstName: user.first_name || '',
                                lastName: user.last_name || ''
                            });
                        }
                    }
                });
            }
        }
        
        console.log(`[DIAG] Teacher in ${diagnostic.groups.length} groups, ${diagnostic.studentRoster.length} students total`);
        
        // 2. If a student email is specified, get their enrollments and activity
        if (studentEmailToDetail && diagnostic.studentRoster.some(s => s.email.toLowerCase() === studentEmailToDetail.toLowerCase())) {
            const student = diagnostic.studentRoster.find(s => s.email.toLowerCase() === studentEmailToDetail.toLowerCase());
            diagnostic.selectedStudent = student;
            
            console.log(`[DIAG] Fetching enrollments for ${student.email}...`);
            
            // Get enrollments
            const enrollments = await thinkific.listEnrollments({
                'query[user_id]': student.thinkificUserId
            });
            
            diagnostic.enrollments = enrollments.map(e => ({
                id: String(e.id),
                courseId: String(e.course_id),
                courseName: e.course_name || 'Unknown',
                activated: !!e.activated_at,
                expired: !!e.expired
            }));
            
            console.log(`[DIAG] Found ${enrollments.length} enrollments`);
            
            // Get recent activity from ActivityEvent table
            const base44 = createClientFromRequest(req);
            const allActivity = await base44.asServiceRole.entities.ActivityEvent.filter({
                studentEmail: student.email
            }, '-created_date', 10);
            
            diagnostic.recentActivity = allActivity.map(e => ({
                id: e.id,
                eventType: e.eventType,
                contentTitle: e.contentTitle,
                courseName: e.courseName,
                occurredAt: e.occurredAt,
                source: e.source
            }));
            
            console.log(`[DIAG] Found ${diagnostic.recentActivity.length} activity events`);
        }
        
        // 3. Backfill capability assessment
        console.log('[DIAG] Assessing backfill capabilities...');
        diagnostic.backfillCapabilities = {
            restEndpoints: {
                enrollments: 'Available (documented)',
                courses: 'Available (documented)',
                userProgress: 'May not exist; use caution'
            },
            graphqlEndpoint: 'Check with capabilities diagnostic',
            recommendation: 'Use REST for enrollments + courses; GraphQL for enriched lesson/quiz data if available; CSV fallback for historical quiz attempts'
        };
        
        return Response.json(diagnostic, { status: 200 });
    } catch (error) {
        console.error('[DIAG] Error:', error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});