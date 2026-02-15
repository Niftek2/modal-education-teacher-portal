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

async function fetchThinkificLessons(courseId, base44) {
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
        const errorText = await chaptersResponse.text();
        console.error(`Failed to fetch chapters for course ${courseId}: ${chaptersResponse.status} - ${errorText}`);
        throw new Error(`Failed to fetch chapters for course ${courseId}: ${chaptersResponse.status}`);
    }

    const chaptersData = await chaptersResponse.json();
    const lessons = [];

    // Collect all content IDs first
    const contentIds = [];
    for (const chapter of chaptersData.items || []) {
        if (chapter.content_ids && Array.isArray(chapter.content_ids)) {
            contentIds.push(...chapter.content_ids.map(id => String(id)));
        }
    }

    // Fetch actual lesson titles from ActivityEvent records
    const titleMap = {};
    if (contentIds.length > 0) {
        const events = await base44.asServiceRole.entities.ActivityEvent.filter({
            contentId: { $in: contentIds }
        });
        
        for (const event of events || []) {
            if (event.contentId && event.contentTitle && !titleMap[event.contentId]) {
                titleMap[event.contentId] = event.contentTitle;
            }
        }
    }

    // Build lessons with actual titles where available
    for (const chapter of chaptersData.items || []) {
        if (chapter.content_ids && Array.isArray(chapter.content_ids)) {
            for (let i = 0; i < chapter.content_ids.length; i++) {
                const contentId = chapter.content_ids[i];
                const contentIdStr = String(contentId);
                
                lessons.push({
                    lessonId: contentIdStr,
                    title: titleMap[contentIdStr] || `${chapter.name} - Item ${i + 1}`,
                    courseId: String(courseId)
                });
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

            try {
                const lessons = await fetchThinkificLessons(courseId, base44);
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
            } catch (error) {
                console.error(`Error syncing course ${courseId} (${level}):`, error.message);
                // Continue with next course instead of failing completely
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