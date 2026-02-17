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

// Temporary: Direct database access for testing
const SUPABASE_URL = Deno.env.get("BASE44_SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("BASE44_SERVICE_ROLE_KEY");

async function dbRequest(path, method = 'GET', body = null) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(url, options);
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`DB error: ${error}`);
    }
    return response.json();
}

Deno.serve(async (req) => {
    try {
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
        
        console.log(`[REMOVE STUDENT] Starting removal for student ${resolvedStudentId} (${studentInfo.email})`);

        // 1. Unenroll from all courses (PK, K, L1-L5)
        const enrollments = await listEnrollments({ 'query[user_id]': resolvedStudentId });
        let unenrolledCount = 0;
        
        for (const enrollment of enrollments) {
            if (COURSE_IDS_TO_UNENROLL.includes(String(enrollment.course_id))) {
                await deleteEnrollment(enrollment.id);
                console.log(`[REMOVE STUDENT] Unenrolled from course ${enrollment.course_id}`);
                unenrolledCount++;
            }
        }
        
        console.log(`[REMOVE STUDENT] Unenrolled from ${unenrolledCount} courses`);

        // 2. Archive the student record
        await dbRequest('ArchivedStudent', 'POST', {
            studentThinkificUserId: String(resolvedStudentId),
            studentEmail: studentInfo.email,
            studentFirstName: studentInfo.first_name,
            studentLastName: studentInfo.last_name,
            teacherThinkificUserId: String(teacherId || 'test_teacher'),
            groupId: String(resolvedGroupId),
            archivedAt: new Date().toISOString()
        });
        
        console.log(`[REMOVE STUDENT] Archived student record`);

        // 3. Delete StudentProfile to remove from active roster
        const studentProfiles = await dbRequest(`StudentProfile?thinkificUserId=eq.${resolvedStudentId}`, 'GET');
        for (const profile of studentProfiles) {
            await dbRequest(`StudentProfile?id=eq.${profile.id}`, 'DELETE');
            console.log(`[REMOVE STUDENT] Deleted StudentProfile ${profile.id}`);
        }

        // 4. Delete all StudentAssignment records
        const studentAssignments = await dbRequest(`StudentAssignment?studentUserId=eq.${String(resolvedStudentId)}`, 'GET');
        for (const assignment of studentAssignments) {
            await dbRequest(`StudentAssignment?id=eq.${assignment.id}`, 'DELETE');
        }
        console.log(`[REMOVE STUDENT] Deleted ${studentAssignments.length} assignments`);

        return Response.json({ 
            success: true, 
            message: `Student removed and archived`,
            unenrolledCount,
            deletedAssignments: studentAssignments.length
        });

    } catch (error) {
        console.error('Remove student error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});