import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

function logApiCall(method, path, status, responseSize) {
    console.log(`[API] ${method} ${path} → ${status} (${responseSize || 0} items)`);
}

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken } = body;
        
        const session = await verifySession(sessionToken);
        const teacherId = session.userId;
        const teacherEmail = session.email;
        
        console.log(`[DIAG] Starting roster resolution for ${teacherEmail} (ID: ${teacherId})`);
        
        const diagnosis = {
            teacherEmail,
            teacherThinkificUserId: String(teacherId),
            entitlementCheck: {
                courseId: CLASSROOM_PRODUCT_ID,
                enrolled: false
            },
            groupsDiscovered: [],
            groupMembersCounts: [],
            rosterStudentEmails: []
        };
        
        // Step 1: Check enrollment in CLASSROOM course
        console.log('\n=== ENTITLEMENT CHECK ===');
        const enrollUrl = `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${teacherId}&query[course_id]=${CLASSROOM_PRODUCT_ID}`;
        console.log(`[CALL] GET ${enrollUrl}`);
        const enrollResponse = await fetch(enrollUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        const enrollData = await enrollResponse.json();
        const enrollments = enrollData.items || [];
        logApiCall('GET', `/enrollments?user_id=${teacherId}&course_id=${CLASSROOM_PRODUCT_ID}`, enrollResponse.status, enrollments.length);
        
        const hasActiveEnrollment = enrollments.some(e => e.activated_at && !e.expired);
        diagnosis.entitlementCheck.enrolled = hasActiveEnrollment;
        console.log(`[RESULT] Course enrollment: ${hasActiveEnrollment ? '✓ ACTIVE' : '✗ NO ENROLLMENT'}`);
        
        // Step 2: Discover all groups teacher is member of
        console.log('\n=== GROUP DISCOVERY ===');
        const groupsUrl = `https://api.thinkific.com/api/public/v1/groups`;
        console.log(`[CALL] GET ${groupsUrl}`);
        const groupsResponse = await fetch(groupsUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.items || [];
        logApiCall('GET', '/groups', groupsResponse.status, allGroups.length);
        console.log(`[INFO] Found ${allGroups.length} total groups in system`);
        
        // Step 3: For each group, check membership and collect members
        const studentEmailsSet = new Set();
        
        for (const group of allGroups) {
            console.log(`\n--- Group: ${group.id} (${group.name}) ---`);
            
            const membersUrl = `https://api.thinkific.com/api/public/v1/users?query[group_id]=${group.id}`;
            console.log(`[CALL] GET ${membersUrl}`);
            const membersResponse = await fetch(membersUrl, {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!membersResponse.ok) {
                logApiCall('GET', `/users?group_id=${group.id}`, membersResponse.status, 0);
                console.log(`[WARN] Failed to fetch members`);
                continue;
            }
            
            const membersData = await membersResponse.json();
            const members = membersData.items || [];
            logApiCall('GET', `/users?group_id=${group.id}`, membersResponse.status, members.length);
            
            // Check if teacher is member of this group
            const isMember = members.some(m => String(m.id) === String(teacherId));
            
            let relationship = 'unknown';
            if (isMember) {
                // Could enhance with owner/admin detection if Thinkific API provides it
                const teacherMember = members.find(m => String(m.id) === String(teacherId));
                relationship = 'member'; // Default; could check role field if available
                console.log(`[RESULT] Teacher IS member of group (relationship: ${relationship})`);
            } else {
                console.log(`[RESULT] Teacher NOT member of group`);
            }
            
            // Count students (by email filter)
            const students = members.filter(m => m.email?.toLowerCase().endsWith('@modalmath.com'));
            
            if (isMember) {
                diagnosis.groupsDiscovered.push({
                    groupId: String(group.id),
                    groupName: group.name,
                    relationship
                });
                
                diagnosis.groupMembersCounts.push({
                    groupId: String(group.id),
                    totalMembers: members.length,
                    studentsAfterEmailFilter: students.length
                });
                
                // Add to roster union
                students.forEach(s => {
                    if (s.email) {
                        studentEmailsSet.add(s.email.toLowerCase());
                    }
                });
                
                console.log(`[STATS] Total members: ${members.length}, Students: ${students.length}`);
            }
        }
        
        // Step 4: Build final roster
        diagnosis.rosterStudentEmails = Array.from(studentEmailsSet).sort();
        
        console.log(`\n=== FINAL ROSTER ===`);
        console.log(`[RESULT] Teacher is in ${diagnosis.groupsDiscovered.length} groups`);
        console.log(`[RESULT] Union roster has ${diagnosis.rosterStudentEmails.length} unique students`);
        
        return Response.json(diagnosis, { status: 200 });
    } catch (error) {
        console.error('[DIAG] Error:', error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});