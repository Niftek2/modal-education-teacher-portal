import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");

async function getGroupStudents(groupId) {
    const response = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[group_id]=${groupId}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch group members: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
}

async function getQuizAttempts(userId) {
    // Thinkific doesn't have a quiz_attempts endpoint in the REST API
    // Quiz data must be retrieved through webhooks (quiz.completed, quiz.failed)
    // For historical data, we need to rely on what's already been captured via webhooks
    console.log(`Note: Quiz attempts for user ${userId} must come from webhooks - no REST endpoint available`);
    return [];
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { groupId } = await req.json();

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        // Get existing quiz completions from Base44 database
        const existingQuizzes = await base44.asServiceRole.entities.QuizCompletion.list('-completedAt', 1000);

        return Response.json({
            success: true,
            synced: existingQuizzes.length,
            message: `Found ${existingQuizzes.length} quiz completions already captured via webhooks. Thinkific API doesn't provide historical quiz data - only real-time via webhooks.`,
            note: 'To capture future quiz completions, ensure quiz.completed and quiz.failed webhooks are properly configured'
        });
    } catch (error) {
        console.error('Sync historical quizzes error:', error);
        return Response.json(
            { error: error.message || 'Failed to sync quiz data' },
            { status: 500 }
        );
    }
});