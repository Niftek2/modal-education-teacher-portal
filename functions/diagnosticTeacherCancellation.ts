import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function getGroupMembers(groupId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships?group_id=${groupId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        }
    });

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return data.items || [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { teacherEmail } = await req.json();

        if (!teacherEmail) {
            return Response.json({ error: 'teacherEmail required' }, { status: 400 });
        }

        const teacherAccessRecords = await base44.asServiceRole.entities.TeacherAccess.filter({
            teacherEmail
        });

        const scheduledJobs = await base44.asServiceRole.entities.ScheduledUnenrollment.filter({
            teacherEmail
        });

        const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.filter({
            teacherEmail
        });

        let rosterCount = 0;
        let groupId = null;

        if (teacherGroups.length > 0) {
            groupId = teacherGroups[0].thinkificGroupId;
            const members = await getGroupMembers(groupId);
            rosterCount = members.filter(m => m.user.email && !m.user.email.endsWith('@modalmath.com')).length;
        }

        return Response.json({
            teacherEmail,
            teacherAccess: teacherAccessRecords.map(record => ({
                id: record.id,
                status: record.status,
                currentPeriodEndAt: record.currentPeriodEndAt,
                currentPeriodEndSource: record.currentPeriodEndSource,
                subscriptionId: record.subscriptionId,
                lastWebhookId: record.lastWebhookId,
                created_date: record.created_date
            })),
            scheduledUnenrollments: scheduledJobs.map(job => ({
                id: job.id,
                runAt: job.runAt,
                status: job.status,
                groupId: job.groupId,
                completedAt: job.completedAt,
                studentsProcessed: job.studentsProcessed,
                studentsUnenrolled: job.studentsUnenrolled,
                errorMessage: job.errorMessage,
                created_date: job.created_date
            })),
            groupInfo: {
                groupId,
                rosterCount
            }
        });

    } catch (error) {
        console.error('Diagnostic teacher cancellation error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});