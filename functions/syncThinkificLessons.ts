import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

const COURSE_IDS = {
    PK: '422595',
    K: '422618',
    L1: '422620',
    L2: '496294',
    L3: '496295',
    L4: '496297',
    L5: '496298'
};

async function fetchThinkificLessons(courseId) {
    const chaptersResponse = await fetch(
        `https://api.thinkific.com/api/public/v1/courses/${courseId}/chapters`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        }
    );

    if (!chaptersResponse.ok) {
        throw new Error(`Failed to fetch chapters for course ${courseId}`);
    }

    const chaptersData = await chaptersResponse.json();
    const lessons = [];

    for (const chapter of chaptersData.items || []) {
        if (chapter.content_ids && Array.isArray(chapter.content_ids)) {
            for (const contentId of chapter.content_ids) {
                // Fetch content details
                const contentResponse = await fetch(
                    `https://api.thinkific.com/api/public/v1/courses/${courseId}/contents/${contentId}`,
                    {
                        headers: {
                            'X-Auth-API-Key': THINKIFIC_API_KEY,
                            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                        }
                    }
                );

                if (contentResponse.ok) {
                    const content = await contentResponse.json();
                    if (content.contentable_type === 'Lesson') {
                        lessons.push({
                            lessonId: String(content.contentable_id),
                            title: content.name,
                            courseId: String(courseId)
                        });
                    }
                }
            }
        }
    }

    return lessons;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // No authentication required - catalog is public
        
        let totalLessons = 0;
        let totalCreated = 0;
        let totalUpdated = 0;

        for (const [level, courseId] of Object.entries(COURSE_IDS)) {
            if (!courseId) continue;

            const lessons = await fetchThinkificLessons(courseId);
            totalLessons += lessons.length;

            for (const lesson of lessons) {
                const thinkificUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/courses/take/${courseId}/lessons/${lesson.lessonId}`;
                
                // Check if already exists
                const existing = await base44.asServiceRole.entities.AssignmentCatalog.filter({
                    lessonId: lesson.lessonId
                });

                if (existing && existing.length > 0) {
                    // Update existing
                    await base44.asServiceRole.entities.AssignmentCatalog.update(existing[0].id, {
                        title: lesson.title,
                        level: level,
                        type: 'lesson',
                        courseId: lesson.courseId,
                        lessonId: lesson.lessonId,
                        thinkificUrl: thinkificUrl,
                        isActive: true
                    });
                    totalUpdated++;
                } else {
                    // Create new
                    await base44.asServiceRole.entities.AssignmentCatalog.create({
                        title: lesson.title,
                        level: level,
                        type: 'lesson',
                        courseId: lesson.courseId,
                        lessonId: lesson.lessonId,
                        thinkificUrl: thinkificUrl,
                        isActive: true
                    });
                    totalCreated++;
                }
            }
        }

        return Response.json({
            success: true,
            totalLessons,
            created: totalCreated,
            updated: totalUpdated,
            message: `Synced ${totalLessons} lessons from Thinkific (${totalCreated} created, ${totalUpdated} updated)`
        });

    } catch (error) {
        console.error('Sync lessons error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});