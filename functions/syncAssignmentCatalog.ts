import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';
import { requestRest } from './lib/thinkificClient.js';

const COURSE_IDS = [
    Deno.env.get("PK_COURSE_ID"),
    Deno.env.get("K_COURSE_ID"),
    Deno.env.get("L1_COURSE_ID"),
    Deno.env.get("L2_COURSE_ID"),
    Deno.env.get("L3_COURSE_ID"),
    Deno.env.get("L4_COURSE_ID"),
    Deno.env.get("L5_COURSE_ID"),
].filter(Boolean);

const COURSE_LEVEL_MAP = {
    [Deno.env.get("PK_COURSE_ID")]: 'PK',
    [Deno.env.get("K_COURSE_ID")]: 'K',
    [Deno.env.get("L1_COURSE_ID")]: 'L1',
    [Deno.env.get("L2_COURSE_ID")]: 'L2',
    [Deno.env.get("L3_COURSE_ID")]: 'L3',
    [Deno.env.get("L4_COURSE_ID")]: 'L4',
    [Deno.env.get("L5_COURSE_ID")]: 'L5',
};

async function fetchAllPages(path, queryParams = {}) {
    const items = [];
    let page = 1;
    while (true) {
        const query = { ...queryParams, page, per_page: 100 };
        const result = await requestRest(path, 'GET', query);
        if (!result.ok) break;
        const pageItems = result.data?.items || [];
        items.push(...pageItems);
        const meta = result.data?.meta || {};
        if (pageItems.length < 100 || items.length >= (meta.total_count || items.length)) break;
        page++;
    }
    return items;
}

function normalizeContentType(content) {
    // Thinkific may return content_type, type, or kind
    const raw = (content.content_type || content.type || content.kind || '').toLowerCase();
    if (raw.includes('quiz')) return 'quiz';
    return 'lesson';
}

function getLessonType(content) {
    // Thinkific returns lesson_type or lesson_type_label for some endpoints
    return content.lesson_type || content.lesson_type_label || content.type_label || null;
}

Deno.serve(async (req) => {
    let session;
    try {
        session = await requireSession(req);
    } catch (e) {
        return Response.json({ error: e.message }, { status: 401 });
    }

    if (!session) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isTeacher = session.isTeacher === true || session.role === 'teacher';
    if (!isTeacher) {
        return Response.json({ error: 'Forbidden: teacher role required' }, { status: 403 });
    }

    try {
        const base44 = createClientFromRequest(req);

        // Load all existing catalog rows once for deduplication
        let existingRows = [];
        let page = 1;
        while (true) {
            const batch = await base44.asServiceRole.entities.AssignmentCatalog.list(
                'created_date', 500, (page - 1) * 500
            );
            existingRows.push(...(batch || []));
            if (!batch || batch.length < 500) break;
            page++;
        }

        // Build lookup by sourceKey
        const bySourceKey = {};
        for (const row of existingRows) {
            if (row.sourceKey) bySourceKey[row.sourceKey] = row;
        }

        let coursesProcessed = 0;
        let itemsCreated = 0;
        let itemsUpdated = 0;
        let itemsSkipped = 0;

        // Log one real sample for inspection
        let sampleLogged = false;

        for (const courseId of COURSE_IDS) {
            const level = COURSE_LEVEL_MAP[courseId] || 'Other';

            // Fetch chapters for this course
            const chapters = await fetchAllPages('/chapters', { 'query[course_id]': courseId });
            coursesProcessed++;

            for (const chapter of chapters) {
                const chapterId = chapter.id;
                const topicName = chapter.name || chapter.title || '';

                // Fetch contents (lessons + quizzes) for this chapter
                const contents = await fetchAllPages('/contents', { 'query[chapter_id]': chapterId });

                // Log one raw content item + what we'd map it to
                if (!sampleLogged && contents.length > 0) {
                    const sample = contents[0];
                    const sampleType = normalizeContentType(sample);
                    const sampleId = sample.id;
                    const sampleKey = `thinkific:${courseId}:${sampleType}:${sampleId}`;
                    console.log('=== SAMPLE /contents RESPONSE ITEM ===');
                    console.log(JSON.stringify(sample, null, 2));
                    console.log('=== MAPPED CATALOG ITEM ===');
                    console.log(JSON.stringify({
                        sourceKey: sampleKey,
                        title: sample.name || sample.title,
                        topic: topicName,
                        contentType: sampleType,
                        thinkificLessonId: sampleType === 'lesson' ? sampleId : undefined,
                        thinkificQuizId: sampleType === 'quiz' ? sampleId : undefined,
                        lessonType: getLessonType(sample),
                    }, null, 2));
                    sampleLogged = true;
                }

                for (const content of contents) {
                    // Derive title from content itself — NEVER from chapter
                    const contentTitle = content.name || content.title || '';
                    if (!contentTitle) {
                        console.log(`SKIP: content id=${content.id} in chapter "${topicName}" has no name/title`);
                        itemsSkipped++;
                        continue;
                    }

                    const contentType = normalizeContentType(content);
                    const contentId = content.id;
                    const sourceKey = `thinkific:${courseId}:${contentType}:${contentId}`;

                    const subdomain = Deno.env.get("THINKIFIC_SUBDOMAIN");
                    const thinkificUrl = content.free_path
                        ? `https://${subdomain}.thinkific.com${content.free_path}`
                        : `https://${subdomain}.thinkific.com/courses/take/${courseId}/lessons/${contentId}`;

                    const catalogData = {
                        title: contentTitle,
                        topic: topicName,
                        chapterId: String(chapterId),
                        chapterName: topicName,
                        type: contentType,           // legacy field
                        contentType,
                        courseId: String(courseId),
                        lessonId: String(contentId), // legacy field
                        thinkificLessonId: contentType === 'lesson' ? contentId : undefined,
                        thinkificQuizId: contentType === 'quiz' ? contentId : undefined,
                        lessonType: getLessonType(content) || undefined,
                        level,
                        isActive: true,
                        sourceKey,
                        thinkificUrl,
                    };

                    const existing = bySourceKey[sourceKey];

                    if (existing) {
                        await base44.asServiceRole.entities.AssignmentCatalog.update(existing.id, {
                            title: catalogData.title,
                            topic: catalogData.topic,
                            chapterName: catalogData.chapterName,
                            level: catalogData.level,
                            type: catalogData.type,
                            contentType: catalogData.contentType,
                            thinkificLessonId: catalogData.thinkificLessonId,
                            thinkificQuizId: catalogData.thinkificQuizId,
                            lessonType: catalogData.lessonType,
                            thinkificUrl: catalogData.thinkificUrl,
                        });
                        itemsUpdated++;
                    } else {
                        const created = await base44.asServiceRole.entities.AssignmentCatalog.create(catalogData);
                        bySourceKey[sourceKey] = created;
                        itemsCreated++;
                    }
                }
            }
        }

        return Response.json({
            success: true,
            coursesProcessed,
            itemsUpserted: itemsCreated + itemsUpdated,
            itemsCreated,
            itemsUpdated,
            itemsSkipped,
        });

    } catch (error) {
        console.error('syncAssignmentCatalog error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});