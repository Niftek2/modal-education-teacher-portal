import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function createDedupeKey(type, userId, contentId, courseId, timestamp) {
    const data = `${type}-${userId}-${contentId || 'none'}-${courseId || 'none'}-${timestamp}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const { csvData } = await req.json();

        if (!Array.isArray(csvData) || csvData.length === 0) {
            return Response.json({ error: 'Invalid or empty csvData' }, { status: 400 });
        }

        let imported = 0;
        let duplicates = 0;
        let errors = [];

        for (const row of csvData) {
            const studentEmail = row['Student Email']?.trim().toLowerCase();
            const courseName = row['Course Name']?.trim() || '';
            const contentTitle = row['Survey/Quiz Name']?.trim() || '';
            const scorePercent = row['% Score'] ? Number(row['% Score']) : null;
            
            // Parse date: "February 12, 2026 21:16"
            let occurredAt = null;
            if (row['Date Completed (UTC)']) {
                try {
                    const dateStr = row['Date Completed (UTC)'].trim();
                    const d = new Date(dateStr);
                    if (!Number.isNaN(d.getTime())) {
                        occurredAt = d.toISOString();
                    }
                } catch (e) {
                    // Skip if date parse fails
                }
            }

            if (!studentEmail || !contentTitle || !occurredAt) {
                errors.push({
                    row: row,
                    reason: 'Missing required fields (email, quiz name, or date)'
                });
                continue;
            }

            // Create dedupeKey based on email + quiz name + date
            const dedupeKey = await createDedupeKey(
                'quiz',
                studentEmail,
                contentTitle,
                courseName,
                occurredAt
            );

            // Check if already exists
            const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ 
                dedupeKey: dedupeKey 
            });

            if (existing.length > 0) {
                duplicates++;
                continue;
            }

            try {
                await base44.asServiceRole.entities.ActivityEvent.create({
                    studentUserId: '',
                    studentEmail: studentEmail,
                    studentDisplayName: row['Student Name']?.trim() || studentEmail.split('@')[0],
                    courseId: '',
                    courseName: courseName,
                    eventType: 'quiz_attempted',
                    contentId: '',
                    contentTitle: contentTitle,
                    occurredAt: occurredAt,
                    source: 'rest_backfill',
                    rawEventId: '',
                    rawPayload: JSON.stringify(row),
                    dedupeKey: dedupeKey,
                    scorePercent: scorePercent,
                    metadata: {
                        totalQuestions: row['Total Number of Questions'] ? Number(row['Total Number of Questions']) : null,
                        correctCount: row['Total Correct'] ? Number(row['Total Correct']) : null
                    }
                });
                imported++;
            } catch (error) {
                errors.push({
                    row: row,
                    reason: error.message
                });
            }
        }

        return Response.json({
            success: true,
            imported,
            duplicates,
            errors,
            total: csvData.length
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});