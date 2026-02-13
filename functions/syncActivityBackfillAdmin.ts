import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ThinkificGraphQL } from './lib/thinkificGraphQL.js';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function makeRequest(endpoint) {
    const url = `https://api.thinkific.com/api/public/v1/${endpoint}`;
    console.log(`[SYNC] Fetching: ${url}`);
    
    const response = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    console.log(`[SYNC] Response status: ${response.status}`);
    
    if (!response.ok) {
        const text = await response.text();
        console.error(`[SYNC] API error ${response.status}: ${text.substring(0, 300)}`);
        throw new Error(`API error ${response.status}`);
    }
    
    return await response.json();
}

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

        console.log(`[SYNC] Starting activity backfill sync as admin`);

        // Get all groups
        const groupsData = await makeRequest('groups?limit=100');
        const groups = groupsData.items || [];
        
        console.log(`[SYNC] Found ${groups.length} groups`);

        let totalEventsImported = 0;
        const results = [];

        for (const group of groups) {
            console.log(`[SYNC] Processing group: ${group.name}`);
            
            try {
                // Get group members
                const groupData = await makeRequest(`groups/${group.id}`);
                const groupMembers = groupData.users || [];
                
                // Filter students (@modalmath.com emails)
                const students = groupMembers.filter(u => u.email?.endsWith('@modalmath.com'));
                console.log(`[SYNC]   Found ${students.length} students`);

                for (const student of students) {
                    console.log(`[SYNC]   Processing student: ${student.email}`);
                    
                    let studentEventsImported = 0;

                    // Fetch quiz attempts via GraphQL
                    try {
                        const quizAttempts = await ThinkificGraphQL.getQuizAttempts(student.id, null);
                        console.log(`[SYNC]     Fetched ${quizAttempts.length} quiz attempts`);
                        
                        for (const attempt of quizAttempts) {
                            if (attempt.submittedAt) {
                                const dedupeKey = await createDedupeKey(
                                    'quiz',
                                    student.id,
                                    attempt.quiz?.id,
                                    attempt.courseName,
                                    attempt.submittedAt
                                );
                                
                                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                                if (existing.length === 0) {
                                    await base44.asServiceRole.entities.ActivityEvent.create({
                                        studentUserId: String(student.id),
                                        studentEmail: student.email,
                                        studentDisplayName: `${student.first_name || ''} ${student.last_name || ''}`.trim(),
                                        courseId: '',
                                        courseName: attempt.courseName || '',
                                        eventType: 'quiz_attempted',
                                        contentId: String(attempt.quiz?.id || ''),
                                        contentTitle: attempt.quiz?.name || 'Unknown Quiz',
                                        occurredAt: attempt.submittedAt,
                                        source: 'rest_backfill',
                                        rawEventId: '',
                                        rawPayload: JSON.stringify(attempt),
                                        dedupeKey,
                                        scorePercent: attempt.percentageScore,
                                        metadata: {
                                            score: attempt.score,
                                            maxScore: attempt.maxScore,
                                            attemptNumber: attempt.attemptNumber || 1,
                                            timeSpentSeconds: attempt.timeSpentSeconds || 0
                                        }
                                    });
                                    studentEventsImported++;
                                    console.log(`[SYNC]       ✓ Quiz: ${attempt.quiz?.name} (${attempt.percentageScore}%)`);
                                }
                            }
                        }
                    } catch (error) {
                        console.error(`[SYNC]     Error fetching quiz attempts:`, error.message);
                    }

                    totalEventsImported += studentEventsImported;
                }
            } catch (error) {
                console.error(`[SYNC]   Error processing group ${group.name}:`, error.message);
            }
        }

        console.log(`[SYNC] Backfill complete. Total events imported: ${totalEventsImported}`);

        return Response.json({
            success: true,
            message: `Backfill complete. Imported ${totalEventsImported} quiz events.`,
            eventsImported: totalEventsImported
        });

    } catch (error) {
        console.error('[SYNC] Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});