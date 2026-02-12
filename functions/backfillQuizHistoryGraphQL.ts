import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token: string) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function createExternalId(userId: string, quizId: string, attemptId: string, createdAt: string) {
    const data = `${userId}-${quizId}-${attemptId}-${createdAt}`;
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function getQuizAttemptsViaWebhookHistory(base44: any, userId: string) {
    // Thinkific doesn't expose quiz history via REST or GraphQL
    // Only available via webhooks or manual export
    // Return empty for now - data comes from webhooks going forward
    console.log(`[BACKFILL] Quiz history not available via API for user ${userId}`);
    return [];
}

async function checkExistingQuizData(base44: any, studentId: string) {
    // Check what quiz data already exists from webhooks
    const existing = await base44.asServiceRole.entities.QuizCompletion.filter({
        studentId: String(studentId)
    }, '-completedAt', 100);
    
    console.log(`[BACKFILL] Found ${existing.length} existing quiz attempts for student ${studentId}`);
    return existing;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId, sessionToken } = await req.json();

        // Verify session token
        await verifySession(sessionToken);

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log(`[GRAPHQL BACKFILL] Starting for group ${groupId}`);

        // Get all students in group via REST API
        const groupUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/api/public/v1/group_users?group_id=${groupId}&limit=250`;
        const groupResponse = await fetch(groupUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        });

        const groupData = await groupResponse.json();
        const allUsers = groupData.items || [];
        const students = allUsers.filter((u: any) => u.email?.toLowerCase().endsWith('@modalmath.com'));

        console.log(`[GRAPHQL BACKFILL] Found ${students.length} students to process`);

        let totalQuizzesAdded = 0;
        let totalQuizzesSkipped = 0;
        let studentsProcessed = 0;
        let errors: any[] = [];

        for (const student of students) {
            studentsProcessed++;
            console.log(`[BACKFILL] Processing ${studentsProcessed}/${students.length}: ${student.email}`);

            try {
                // Check what data already exists from webhooks
                const existingQuizzes = await checkExistingQuizData(base44, student.id);
                totalQuizzesSkipped += existingQuizzes.length;

            } catch (error: any) {
                console.error(`[BACKFILL] Error for ${student.email}:`, error.message);
                errors.push({
                    student: student.email,
                    error: error.message
                });
            }
        }

        console.log(`[BACKFILL] Complete: ${totalQuizzesSkipped} existing quiz records found`);

        return Response.json({
            success: true,
            studentsProcessed,
            quizzesAdded: 0,
            quizzesSkipped: totalQuizzesSkipped,
            existingRecords: totalQuizzesSkipped,
            errors: errors.length > 0 ? errors : undefined,
            message: totalQuizzesSkipped > 0 
                ? `Found ${totalQuizzesSkipped} quiz attempts already captured via webhooks. Historical data unavailable via Thinkific API - only new attempts are captured.`
                : `No quiz attempts found yet. New quiz attempts will be automatically captured via webhooks.`
        });

    } catch (error: any) {
        console.error('[GRAPHQL BACKFILL] Fatal error:', error);
        return Response.json({ 
            error: error.message,
            details: 'Check function logs for more information'
        }, { status: 500 });
    }
});