import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { studentEmail } = await req.json();
        if (!studentEmail) {
            return Response.json({ error: 'Missing studentEmail' }, { status: 400 });
        }

        const normalizedEmailUsed = studentEmail.trim().toLowerCase();

        // Query all ActivityEvents and filter for this student
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list(null, 500);

        // Match by different keys
        const matchByEmail = allEvents.filter(e => 
            e.studentEmail?.toLowerCase() === normalizedEmailUsed
        );

        const matchByUserId = allEvents.filter(e => {
            const metadata = e.metadata || {};
            return metadata.userId === studentEmail || 
                   e.studentUserId === studentEmail;
        });

        const matchByAziza = allEvents.filter(e => 
            e.studentEmail?.toLowerCase().includes('aziza') ||
            e.studentDisplayName?.toLowerCase().includes('aziza')
        );

        const sample = (arr, limit = 10) => arr.slice(0, limit).map(e => ({
            id: e.id,
            eventType: e.eventType,
            studentEmail: e.studentEmail,
            occurredAt: e.occurredAt,
            scorePercent: e.scorePercent,
            studentUserId: e.studentUserId,
            metadata_userId: e.metadata?.userId,
            metadata_resultId: e.metadata?.resultId
        }));

        return Response.json({
            normalizedEmailUsed,
            studentEmail_input: studentEmail,
            matchCounts: {
                byEmail: matchByEmail.length,
                byUserId: matchByUserId.length,
                byAziza: matchByAziza.length
            },
            sampleByEmail: sample(matchByEmail),
            sampleByUserId: sample(matchByUserId),
            sampleByAziza: sample(matchByAziza)
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});