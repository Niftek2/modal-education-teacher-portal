import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';
import { getUser, listEnrollments, deleteEnrollment } from './lib/thinkificClient.js';

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
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const { studentId, groupId, teacherId } = await req.json();

        if (!studentId || !groupId) {
            return Response.json({ error: 'Student ID and Group ID required' }, { status: 400 });
        }

        // Get student info
        const studentInfo = await getUser(studentId);
        
        console.log(`[REMOVE STUDENT] Starting removal for student ${studentId} (${studentInfo.email})`);

        // 1. Unenroll from all courses (PK, K, L1-L5)
        const enrollments = await listEnrollments({ 'query[user_id]': studentId });
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
        await base44.asServiceRole.entities.ArchivedStudent.create({
            studentThinkificUserId: String(studentId),
            studentEmail: studentInfo.email,
            studentFirstName: studentInfo.first_name,
            studentLastName: studentInfo.last_name,
            teacherThinkificUserId: String(teacherId || session.userId),
            groupId: String(groupId),
            archivedAt: new Date().toISOString()
        });
        
        console.log(`[REMOVE STUDENT] Archived student record`);

        // 3. Delete StudentProfile to remove from active roster
        const studentProfiles = await base44.asServiceRole.entities.StudentProfile.filter({ 
            thinkificUserId: Number(studentId) 
        });
        for (const profile of studentProfiles) {
            await base44.asServiceRole.entities.StudentProfile.delete(profile.id);
            console.log(`[REMOVE STUDENT] Deleted StudentProfile ${profile.id}`);
        }

        // 4. Delete all StudentAssignment records
        const studentAssignments = await base44.asServiceRole.entities.StudentAssignment.filter({ 
            studentUserId: String(studentId) 
        });
        for (const assignment of studentAssignments) {
            await base44.asServiceRole.entities.StudentAssignment.delete(assignment.id);
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