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

const DELAY_MS = 500;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function thinkificGet(path) {
    const url = `https://api.thinkific.com/api/public/v1${path}${path.includes('?') ? '&' : '?'}limit=250`;
    const res = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        }
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Thinkific API ${res.status} for ${path}: ${text}`);
    }
    return res.json();
}

// Clean a lesson title: strip "- Part N", "- Item N" suffixes
function cleanTitle(raw) {
    return raw
        .replace(/\s*-\s*(Part|Item)\s*\d+\s*$/gi, '')
        .replace(/\s*(Part|Item)\s*\d+\s*$/gi, '')
        .trim();
}

async function fetchThinkificLessons(courseId) {
    const chaptersData = await thinkificGet(`/courses/${courseId}/chapters`);
    await delay(DELAY_MS);

    const lessons = [];

    for (const chapter of chaptersData.items || []) {
        const topic = chapter.name || '';

        if (chapter.content_ids && Array.isArray(chapter.content_ids)) {
            for (const contentId of chapter.content_ids) {
                let lessonTitle = topic; // safe fallback: chapter name without "Item N"

                try {
                    const contentData = await thinkificGet(`/contents/${contentId}`);
                    await delay(DELAY_MS);
                    if (contentData.name) {
                        lessonTitle = contentData.name;
                    }
                } catch (err) {
                    console.warn(`Could not fetch content ${contentId}: ${err.message}`);
                }

                lessons.push({
                    lessonId: String(contentId),
                    title: cleanTitle(lessonTitle),
                    topic: topic,
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

        let totalLessons = 0;
        let totalCreated = 0;
        let totalUpdated = 0;
        const errors = [];

        for (const [level, courseId] of Object.entries(COURSE_IDS)) {
            if (!courseId) continue;
            console.log(`Syncing ${level} (courseId=${courseId})...`);

            try {
                const lessons = await fetchThinkificLessons(courseId);
                totalLessons += lessons.length;
                console.log(`  Found ${lessons.length} lessons`);

                for (const lesson of lessons) {
                    const thinkificUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/courses/take/${courseId}/lessons/${lesson.lessonId}`;

                    const existing = await base44.asServiceRole.entities.AssignmentCatalog.filter({
                        lessonId: lesson.lessonId
                    });

                    const payload = {
                        title: lesson.title,
                        topic: lesson.topic,
                        level,
                        type: 'lesson',
                        courseId: lesson.courseId,
                        lessonId: lesson.lessonId,
                        thinkificUrl,
                        isActive: true
                    };

                    if (existing && existing.length > 0) {
                        await base44.asServiceRole.entities.AssignmentCatalog.update(existing[0].id, payload);
                        totalUpdated++;
                    } else {
                        await base44.asServiceRole.entities.AssignmentCatalog.create(payload);
                        totalCreated++;
                    }
                }
            } catch (error) {
                console.error(`Error syncing ${level} (${courseId}): ${error.message}`);
                errors.push({ level, courseId, error: error.message });
            }
        }

        return Response.json({
            success: true,
            totalLessons,
            created: totalCreated,
            updated: totalUpdated,
            errors,
            message: `Synced ${totalLessons} lessons (${totalCreated} created, ${totalUpdated} updated, ${errors.length} course errors)`
        });

    } catch (error) {
        console.error('Sync lessons error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});