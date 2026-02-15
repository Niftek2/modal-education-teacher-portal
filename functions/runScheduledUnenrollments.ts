import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

const COURSE_IDS = {
    PK: Deno.env.get("COURSE_ID_PK"),
    K: Deno.env.get("COURSE_ID_K"),
    L1: Deno.env.get("COURSE_ID_L1"),
    L2: Deno.env.get("COURSE_ID_L2"),
    L3: Deno.env.get("COURSE_ID_L3"),
    L4: Deno.env.get("COURSE_ID_L4"),
    L5: Deno.env.get("COURSE_ID_L5")
};

async function getGroupMembers(groupId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships?group_id=${groupId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch group members: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
}

async function unenrollFromCourses(userId) {
    const results = [];
    
    for (const [level, courseId] of Object.entries(COURSE_IDS)) {
        if (!courseId) continue;
        
        try {
            const response = await fetch(`https://api.thinkific.com/api/public/v1/enrollments?user_id=${userId}&course_id=${courseId}`, {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            });

            if (response.ok) {
                const data = await response.json();
                const enrollments = data.items || [];
                
                for (const enrollment of enrollments) {
                    const deleteResponse = await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`, {
                        method: 'DELETE',
                        headers: {
                            'X-Auth-API-Key': THINKIFIC_API_KEY,
                            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                        }
                    });
                    
                    if (deleteResponse.ok) {
                        results.push({ level, success: true });
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to unenroll from ${level}:`, error);
            results.push({ level, success: false, error: error.message });
        }
    }
    
    return results;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const now = new Date().toISOString();
        const jobs = await base44.asServiceRole.entities.ScheduledUnenrollment.filter({
            status: 'scheduled'
        });

        const dueJobs = jobs.filter(job => new Date(job.runAt) <= new Date());

        if (dueJobs.length === 0) {
            return Response.json({ 
                message: 'No jobs due to run',
                checked: jobs.length,
                executed: 0
            });
        }

        const results = [];

        for (const job of dueJobs) {
            try {
                const members = await getGroupMembers(job.groupId);
                const students = members.filter(m => m.user.email && !m.user.email.endsWith('@modalmath.com'));

                let studentsProcessed = 0;
                let studentsUnenrolled = 0;

                for (const student of students) {
                    studentsProcessed++;
                    try {
                        await unenrollFromCourses(student.user.id);
                        studentsUnenrolled++;
                    } catch (error) {
                        console.error(`Failed to unenroll student ${student.user.email}:`, error);
                    }
                }

                await base44.asServiceRole.entities.ScheduledUnenrollment.update(job.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    studentsProcessed,
                    studentsUnenrolled
                });

                const teacherAccess = await base44.asServiceRole.entities.TeacherAccess.filter({
                    teacherEmail: job.teacherEmail
                });

                if (teacherAccess.length > 0) {
                    await base44.asServiceRole.entities.TeacherAccess.update(teacherAccess[0].id, {
                        status: 'ended'
                    });
                }

                results.push({
                    jobId: job.id,
                    teacherEmail: job.teacherEmail,
                    success: true,
                    studentsProcessed,
                    studentsUnenrolled
                });

            } catch (error) {
                await base44.asServiceRole.entities.ScheduledUnenrollment.update(job.id, {
                    status: 'failed',
                    errorMessage: error.message,
                    completedAt: new Date().toISOString()
                });

                results.push({
                    jobId: job.id,
                    teacherEmail: job.teacherEmail,
                    success: false,
                    error: error.message
                });
            }
        }

        return Response.json({
            message: 'Jobs processed',
            totalJobs: dueJobs.length,
            results
        });

    } catch (error) {
        console.error('Run scheduled unenrollments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});