import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requestRest } from './lib/thinkificClient.js';

/**
 * Resolves a slug-based Thinkific URL for a given assignment.
 * Uses free_path from the /contents API when available.
 * Falls back to /courses/{id} slug + level-label construction.
 */

const COURSE_LEVEL_MAP = {
    [Deno.env.get("PK_COURSE_ID")]: 'pre-k',
    [Deno.env.get("K_COURSE_ID")]: 'kindergarten',
    [Deno.env.get("L1_COURSE_ID")]: 'level-1',
    [Deno.env.get("L2_COURSE_ID")]: 'level-2',
    [Deno.env.get("L3_COURSE_ID")]: 'level-3',
    [Deno.env.get("L4_COURSE_ID")]: 'level-4',
    [Deno.env.get("L5_COURSE_ID")]: 'level-5',
};

// In-memory cache for course slugs (warm across requests in same instance)
const courseSlugCache = {};

async function getCourseSlug(courseId) {
    if (courseSlugCache[courseId]) return courseSlugCache[courseId];

    // Prefer hardcoded map
    if (COURSE_LEVEL_MAP[String(courseId)]) {
        courseSlugCache[courseId] = COURSE_LEVEL_MAP[String(courseId)];
        return courseSlugCache[courseId];
    }

    // Fall back to Thinkific API
    try {
        const result = await requestRest(`/courses/${courseId}`);
        if (result.ok && result.data?.slug) {
            courseSlugCache[courseId] = result.data.slug;
            return result.data.slug;
        }
    } catch (e) {
        console.error(`getCourseSlug failed for ${courseId}:`, e.message);
    }
    return null;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);

    let assignmentId, catalogId, courseId, contentType, contentId;
    try {
        const body = await req.json();
        assignmentId = body.assignmentId;
        catalogId = body.catalogId;
        courseId = body.courseId;
        contentType = body.contentType; // 'lesson' or 'quiz'
        contentId = body.contentId;     // lessonId or quizId
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!contentId || !courseId || !contentType) {
        return Response.json({ error: 'courseId, contentType, and contentId are required' }, { status: 400 });
    }

    try {
        // Check catalog for existing good URL first
        if (catalogId) {
            const cats = await base44.asServiceRole.entities.AssignmentCatalog.filter({ id: catalogId });
            const cat = cats?.[0];
            if (cat?.thinkificUrl && !cat.thinkificUrl.includes(`/courses/take/${courseId}/`)) {
                // URL doesn't contain numeric courseId in take path — it's slug-based, use it
                console.log(`[resolveUrl] Using stored slug URL from catalog: ${cat.thinkificUrl}`);
                return Response.json({ url: cat.thinkificUrl });
            }
        }

        // Try fetching free_path from /contents API
        // We need to search by chapter — not directly by content id, so use course chapters
        let resolvedUrl = null;

        // Attempt: fetch chapters for course, then contents for each chapter until we find our content
        const chaptersResult = await requestRest('/chapters', 'GET', { 'query[course_id]': String(courseId) });
        if (chaptersResult.ok) {
            const chapters = chaptersResult.data?.items || [];
            outerLoop:
            for (const chapter of chapters) {
                const contentsResult = await requestRest('/contents', 'GET', { 'query[chapter_id]': String(chapter.id) });
                if (!contentsResult.ok) continue;
                const contents = contentsResult.data?.items || [];
                for (const c of contents) {
                    if (String(c.id) === String(contentId)) {
                        if (c.free_path) {
                            resolvedUrl = `https://learn.modaleducation.com${c.free_path}`;
                        }
                        break outerLoop;
                    }
                }
            }
        }

        // Fallback: build from course slug
        if (!resolvedUrl) {
            const courseSlug = await getCourseSlug(String(courseId));
            if (courseSlug) {
                const kind = contentType === 'quiz' ? 'quizzes' : 'lessons';
                resolvedUrl = `https://learn.modaleducation.com/courses/take/${courseSlug}/${kind}/${contentId}`;
            }
        }

        if (!resolvedUrl) {
            return Response.json({ error: 'Could not resolve URL for this assignment' }, { status: 404 });
        }

        // Update catalog with the resolved URL so future calls are instant
        if (catalogId) {
            await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, {
                thinkificUrl: resolvedUrl,
                contentUrl: resolvedUrl,
            }).catch(() => {}); // non-fatal
        }
        // Update assignment too
        if (assignmentId) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignmentId, {
                contentUrl: resolvedUrl,
                thinkificUrl: resolvedUrl,
            }).catch(() => {}); // non-fatal
        }

        console.log(`[resolveUrl] Resolved: ${resolvedUrl}`);
        return Response.json({ url: resolvedUrl });

    } catch (error) {
        console.error('[resolveUrl] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});