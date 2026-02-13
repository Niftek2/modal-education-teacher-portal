import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

const COURSE_IDS = {
    PK: Deno.env.get("COURSE_ID_PK"),
    L1: Deno.env.get("COURSE_ID_L1"),
    L2: Deno.env.get("COURSE_ID_L2"),
    L3: Deno.env.get("COURSE_ID_L3"),
    L4: Deno.env.get("COURSE_ID_L4"),
    L5: Deno.env.get("COURSE_ID_L5")
};

async function verifySession(req) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('Unauthorized');
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

async function findGroupMembership(userId, groupId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}&query[group_id]=${groupId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error('Failed to find membership');
    }

    const data = await response.json();
    return data.items?.[0];
}

async function removeGroupMembership(membershipId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships/${membershipId}`, {
        method: 'DELETE',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    return response.ok;
}

async function unenrollFromCourses(userId) {
    const unenrollments = [];
    
    for (const [level, courseId] of Object.entries(COURSE_IDS)) {
        if (!courseId) continue;
        
        try {
            // Find enrollment
            const findResponse = await fetch(`https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${courseId}`, {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            });

            if (findResponse.ok) {
                const data = await findResponse.json();
                const enrollment = data.items?.[0];
                
                if (enrollment) {
                    // Delete enrollment
                    const deleteResponse = await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`, {
                        method: 'DELETE',
                        headers: {
                            'X-Auth-API-Key': THINKIFIC_API_KEY,
                            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                        }
                    });

                    if (deleteResponse.ok) {
                        unenrollments.push(level);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to unenroll from ${level}:`, error);
        }
    }
    
    return unenrollments;
}

async function getStudentInfo(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        }
    });

    if (!response.ok) {
        return null;
    }

    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const session = await verifySession(req);
        const { studentId, groupId, teacherId } = await req.json();

        if (!studentId || !groupId) {
            return Response.json({ error: 'Student ID and Group ID required' }, { status: 400 });
        }

        // Get student info before removal
        const studentInfo = await getStudentInfo(studentId);

        // Find membership
        const membership = await findGroupMembership(studentId, groupId);
        
        if (!membership) {
            return Response.json({ error: 'Membership not found' }, { status: 404 });
        }

        // Unenroll from courses
        await unenrollFromCourses(studentId);

        // Remove from group
        const success = await removeGroupMembership(membership.id);

        if (!success) {
            return Response.json({ error: 'Failed to remove student' }, { status: 500 });
        }

        // Archive the student record
        if (studentInfo) {
            await base44.asServiceRole.entities.ArchivedStudent.create({
                studentThinkificUserId: String(studentId),
                studentEmail: studentInfo.email,
                studentFirstName: studentInfo.first_name,
                studentLastName: studentInfo.last_name,
                teacherThinkificUserId: String(teacherId || session.userId),
                groupId: String(groupId),
                archivedAt: new Date().toISOString()
            });
        }

        return Response.json({ success: true });

    } catch (error) {
        console.error('Remove student error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});