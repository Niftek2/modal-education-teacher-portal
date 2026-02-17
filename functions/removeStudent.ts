import { getUser, listEnrollments, deleteEnrollment, findUserByEmail, listGroups, listGroupUsers } from './lib/thinkificClient.js';

// Course IDs for PK, K, L1-L5
const COURSE_IDS_TO_UNENROLL = [
    Deno.env.get("PK_COURSE_ID"),
    Deno.env.get("K_COURSE_ID"),
    Deno.env.get("L1_COURSE_ID"),
    Deno.env.get("L2_COURSE_ID"),
    Deno.env.get("L3_COURSE_ID"),
    Deno.env.get("L4_COURSE_ID"),
    Deno.env.get("L5_COURSE_ID")
].filter(Boolean);

Deno.serve(async (req) => {
    try {
        // Import SDK here to use service role without auth
        const { createServiceRoleClient } = await import('npm:@base44/sdk@0.8.6');
        const base44 = createServiceRoleClient();

        const { studentId, groupId, teacherId, studentEmail, groupName } = await req.json();

        let resolvedStudentId = studentId;
        let resolvedGroupId = groupId;

        // If email and groupName provided, resolve IDs
        if (studentEmail && groupName && (!studentId || !groupId)) {
            console.log(`[REMOVE STUDENT] Resolving IDs for ${studentEmail} in group ${groupName}`);
            
            // Find student by email
            const student = await findUserByEmail(studentEmail);
            if (!student) {
                return Response.json({ error: `Student not found: ${studentEmail}` }, { status: 404 });
            }
            resolvedStudentId = student.id;
            console.log(`[REMOVE STUDENT] Resolved student ID: ${resolvedStudentId}`);

            // Find group by name
            const allGroups = await listGroups();
            const matchingGroups = allGroups.filter(g => g.name === groupName);
            
            if (matchingGroups.length === 0) {
                return Response.json({ error: `Group not found: ${groupName}` }, { status: 404 });
            }

            // Try to find the group containing the student
            for (const group of matchingGroups) {
                const groupUsers = await listGroupUsers(group.id);
                if (groupUsers.find(u => u.email === studentEmail)) {
                    resolvedGroupId = group.id;
                    console.log(`[REMOVE STUDENT] Resolved group ID: ${resolvedGroupId}`);
                    break;
                }
            }

            if (!resolvedGroupId) {
                resolvedGroupId = matchingGroups[0].id;
                console.log(`[REMOVE STUDENT] Using first matching group ID: ${resolvedGroupId}`);
            }
        }

        if (!resolvedStudentId || !resolvedGroupId) {
            return Response.json({ error: 'Student ID and Group ID required (or provide studentEmail and groupName)' }, { status: 400 });
        }

        // Get student info
        const studentInfo = await getUser(resolvedStudentId);
        if (!studentInfo) {
            console.error(`[REMOVE STUDENT] Student not found in Thinkific: ${resolvedStudentId}`);
            return Response.json({ error: `Student not found: ${resolvedStudentId}` }, { status: 404 });
        }
        
        console.log(`[REMOVE STUDENT] Starting removal for student ${resolvedStudentId} (${studentInfo.email})`);

        // 1. Unenroll from all courses (PK, K, L1-L5)
        const enrollments = await listEnrollments({ 'query[user_id]': resolvedStudentId });
        let unenrolledCount = 0;
        
        for (const enrollment of enrollments) {
            if (COURSE_IDS_TO_UNENROLL.includes(String(enrollment.course_id))) {
                const deleteResult = await deleteEnrollment(enrollment.id);
                if (!deleteResult.ok) {
                    console.error(`[REMOVE STUDENT] Failed deleting enrollment ${enrollment.id}: status ${deleteResult.status}`);
                    return Response.json({ 
                        error: `Failed to unenroll from course ${enrollment.course_id}: status ${deleteResult.status}` 
                    }, { status: 500 });
                }
                console.log(`[REMOVE STUDENT] Unenrolled from course ${enrollment.course_id} (enrollment ${enrollment.id})`);
                unenrolledCount++;
            }
        }
        
        console.log(`[REMOVE STUDENT] Unenrolled from ${unenrolledCount} courses`);

        // 2. Archive the student record
        await base44.entities.ArchivedStudent.create({
            studentThinkificUserId: String(resolvedStudentId),
            studentEmail: studentInfo.email,
            studentFirstName: studentInfo.first_name,
            studentLastName: studentInfo.last_name,
            teacherThinkificUserId: String(teacherId || 'test_teacher'),
            groupId: String(resolvedGroupId),
            archivedAt: new Date().toISOString()
        });
        
        console.log(`[REMOVE STUDENT] Archived student record`);

        return Response.json({ 
            success: true, 
            message: `Student unenrolled and archived`,
            unenrolledCount
        });

    } catch (error) {
        console.error('Remove student error:', error);
        console.error('Remove student error (full):', error?.stack || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});