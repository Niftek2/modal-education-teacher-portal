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
                let studentsProcessed = 0;
                let studentsUnenrolled = 0;

                if (job.jobType === 'student') {
                    // Per-student unenrollment
                    studentsProcessed = 1;
                    let userId = job.studentThinkificUserId;

                    // Look up by email if we don't have the ID
                    if (!userId && job.studentEmail) {
                        const res = await fetch(
                            `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(job.studentEmail)}`,
                            { headers: thinkificHeaders }
                        );
                        if (res.ok) {
                            const data = await res.json();
                            userId = data.items?.[0]?.id ? String(data.items[0].id) : null;
                        }
                    }

                    if (userId) {
                        const unenrollResults = await unenrollFromCourses(userId);
                        const succeeded = unenrollResults.filter(r => r.success).length;
                        if (succeeded > 0) studentsUnenrolled = 1;
                        console.log(`[runScheduledUnenrollments] Student ${job.studentEmail}: unenrolled from ${succeeded} courses`);
                    } else {
                        console.warn(`[runScheduledUnenrollments] No Thinkific user ID for ${job.studentEmail}, skipping`);
                    }
                } else {
                    // Group-level unenrollment (existing behavior)
                    const members = await getGroupMembers(job.groupId);
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

                    const teacherAccess = await base44.asServiceRole.entities.TeacherAccess.filter({ teacherEmail: job.teacherEmail });
                    if (teacherAccess.length > 0) {
                        await base44.asServiceRole.entities.TeacherAccess.update(teacherAccess[0].id, { status: 'ended' });
                    }
                }

                await base44.asServiceRole.entities.ScheduledUnenrollment.update(job.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    studentsProcessed,
                    studentsUnenrolled,
                });

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