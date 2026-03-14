import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
    'Content-Type': 'application/json',
};

const COURSE_IDS = {
    PK: Deno.env.get("PK_COURSE_ID"),
    K: Deno.env.get("K_COURSE_ID"),
    L1: Deno.env.get("L1_COURSE_ID"),
    L2: Deno.env.get("L2_COURSE_ID"),
    L3: Deno.env.get("L3_COURSE_ID"),
    L4: Deno.env.get("L4_COURSE_ID"),
    L5: Deno.env.get("L5_COURSE_ID"),
};

async function getGroupMembers(groupId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/group_users?query[group_id]=${groupId}&limit=100`,
        { headers: thinkificHeaders }
    );
    if (!res.ok) throw new Error(`Failed to fetch group members: ${res.status}`);
    const data = await res.json();
    // group_users returns items with { user_id } — we need full user objects
    return data.items || [];
}

async function unenrollFromCourses(userId) {
    const results = [];

    for (const [level, courseId] of Object.entries(COURSE_IDS)) {
        if (!courseId) continue;

        try {
            // Find enrollment
            const enrollRes = await fetch(
                `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${courseId}`,
                { headers: thinkificHeaders }
            );

            if (!enrollRes.ok) continue;
            const enrollData = await enrollRes.json();

            for (const enrollment of (enrollData.items || [])) {
                const delRes = await fetch(
                    `https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`,
                    { method: 'DELETE', headers: thinkificHeaders }
                );
                results.push({ level, enrollmentId: enrollment.id, success: delRes.ok });
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

        const jobs = await base44.asServiceRole.entities.ScheduledUnenrollment.filter({ status: 'scheduled' });
        const dueJobs = jobs.filter(job => new Date(job.runAt) <= new Date());

        if (dueJobs.length === 0) {
            return Response.json({ message: 'No jobs due to run', checked: jobs.length, executed: 0 });
        }

        const results = [];

        for (const job of dueJobs) {
            try {
                // Get group members (returns items with user_id)
                const members = await getGroupMembers(job.groupId);

                let studentsProcessed = 0;
                let studentsUnenrolled = 0;

                for (const member of members) {
                    const userId = member.user_id;
                    if (!userId) continue;
                    studentsProcessed++;
                    try {
                        await unenrollFromCourses(userId);
                        studentsUnenrolled++;
                    } catch (error) {
                        console.error(`Failed to unenroll userId=${userId}:`, error);
                    }
                }

                await base44.asServiceRole.entities.ScheduledUnenrollment.update(job.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    studentsProcessed,
                    studentsUnenrolled,
                });

                const teacherAccess = await base44.asServiceRole.entities.TeacherAccess.filter({ teacherEmail: job.teacherEmail });
                if (teacherAccess.length > 0) {
                    await base44.asServiceRole.entities.TeacherAccess.update(teacherAccess[0].id, { status: 'ended' });
                }

                results.push({ jobId: job.id, teacherEmail: job.teacherEmail, success: true, studentsProcessed, studentsUnenrolled });

            } catch (error) {
                await base44.asServiceRole.entities.ScheduledUnenrollment.update(job.id, {
                    status: 'failed',
                    errorMessage: error.message,
                    completedAt: new Date().toISOString(),
                });
                results.push({ jobId: job.id, teacherEmail: job.teacherEmail, success: false, error: error.message });
            }
        }

        return Response.json({ message: 'Jobs processed', totalJobs: dueJobs.length, results });

    } catch (error) {
        console.error('Run scheduled unenrollments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});