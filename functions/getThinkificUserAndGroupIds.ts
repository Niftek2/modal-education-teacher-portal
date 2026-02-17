import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';
import { findUserByEmail, listGroups, listGroupUsers } from './lib/thinkificClient.js';

Deno.serve(async (req) => {
    const session = await requireSession(req);

    if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { studentEmail, teacherEmail, groupName } = await req.json();

        if (!studentEmail || !teacherEmail || !groupName) {
            return Response.json({ 
                error: 'Missing required fields: studentEmail, teacherEmail, groupName' 
            }, { status: 400 });
        }

        console.log(`[LOOKUP] Searching for student: ${studentEmail}`);
        console.log(`[LOOKUP] Searching for teacher: ${teacherEmail} with group: ${groupName}`);

        // 1. Find student by email
        const student = await findUserByEmail(studentEmail);
        if (!student) {
            return Response.json({ 
                error: `Student not found in Thinkific: ${studentEmail}` 
            }, { status: 404 });
        }

        console.log(`[LOOKUP] Found student: ID ${student.id}, Email ${student.email}`);

        // 2. Find teacher's group
        const allGroups = await listGroups();
        console.log(`[LOOKUP] Total groups in Thinkific: ${allGroups.length}`);

        // Find groups that match the group name
        const matchingGroups = allGroups.filter(g => g.name === groupName);
        console.log(`[LOOKUP] Found ${matchingGroups.length} groups matching "${groupName}"`);

        if (matchingGroups.length === 0) {
            return Response.json({ 
                error: `Group not found: ${groupName}`,
                availableGroups: allGroups.map(g => ({ id: g.id, name: g.name }))
            }, { status: 404 });
        }

        // If multiple groups with same name, try to find the one with the student
        let targetGroup = null;
        for (const group of matchingGroups) {
            const groupUsers = await listGroupUsers(group.id);
            const studentInGroup = groupUsers.find(u => u.email === studentEmail);
            if (studentInGroup) {
                targetGroup = group;
                console.log(`[LOOKUP] Found student in group ID ${group.id}`);
                break;
            }
        }

        // If not found in any group, just use the first matching group
        if (!targetGroup) {
            targetGroup = matchingGroups[0];
            console.log(`[LOOKUP] Student not found in any matching group, using first match: ${targetGroup.id}`);
        }

        return Response.json({
            success: true,
            studentId: student.id,
            studentEmail: student.email,
            studentName: `${student.first_name} ${student.last_name}`.trim(),
            groupId: targetGroup.id,
            groupName: targetGroup.name,
            teacherId: session.userId
        });

    } catch (error) {
        console.error('[LOOKUP] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});