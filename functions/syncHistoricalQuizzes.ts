import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ThinkificClient } from './lib/thinkificClient.js';

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
            note: 'To capture future quiz completions, ensure quiz.attempted webhook is properly configured in Thinkific'
        });
    } catch (error) {
        console.error('Sync historical quizzes error:', error);
        return Response.json(
            { error: error.message || 'Failed to sync quiz data' },
            { status: 500 }
        );
    }
});