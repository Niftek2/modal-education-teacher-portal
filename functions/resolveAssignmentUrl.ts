import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requestRest } from './lib/thinkificClient.js';

/**
 * Resolves a slug-based Thinkific URL for a given assignment.
 * 
 * Hierarchy:
 * 1. Use content.free_path when available (best).
 * 2. Fetch real course slug from /courses/{id} and build /courses/take/{slug}/...
 * 3. Fail cleanly (404) if neither available — NEVER use numeric course IDs.
 * 
 * Always prepends https://learn.modaleducation.com (custom domain).
 */

// In-memory cache for course slugs
const courseSlugCache = {};

async function getCourseSlug(courseId) {
    if (courseSlugCache[courseId]) return courseSlugCache[courseId];

    try {
        const result = await requestRest(`/courses/${courseId}`);
        if (result.ok && result.data?.slug) {
            courseSlugCache[courseId] = result.data.slug;
            return result.data.slug;
        }
    } catch (e) {
        console.warn(`Could not fetch course slug for ${courseId}:`, e.message);
    }
    return null;
}

/**
 * Build a valid Thinkific URL from content or slug.
 */
function buildUrlFromContent(content, courseSlug, contentType) {
    const domain = 'https://learn.modaleducation.com';
    
    if (content?.free_path) {
        return `${domain}${content.free_path}`;
    }
    
    if (courseSlug && content?.id) {
        const contentKind = contentType === 'quiz' ? 'quizzes' : 'lessons';
        return `${domain}/courses/take/${courseSlug}/${contentKind}/${content.id}`;
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
        let resolvedUrl = null;

        // Step 1: Try fetching free_path from /contents API by searching chapters
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

        // Step 2: If no free_path, fetch real course slug and build URL
        if (!resolvedUrl) {
            const courseSlug = await getCourseSlug(courseId);
            if (courseSlug) {
                const contentKind = contentType === 'quiz' ? 'quizzes' : 'lessons';
                resolvedUrl = `https://learn.modaleducation.com/courses/take/${courseSlug}/${contentKind}/${contentId}`;
            }
        }

        // Step 3: Fail cleanly if we cannot resolve
        if (!resolvedUrl) {
            console.warn(`[resolveUrl] Cannot resolve URL: courseId=${courseId}, contentId=${contentId}`);
            return Response.json({ error: 'Unable to resolve assignment URL. Please try again.' }, { status: 404 });
        }

        // Update catalog and assignment with resolved URL (non-fatal if this fails)
        if (catalogId) {
            await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, {
                thinkificUrl: resolvedUrl,
                contentUrl: resolvedUrl,
            }).catch(() => {});
        }
        if (assignmentId) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignmentId, {
                contentUrl: resolvedUrl,
                thinkificUrl: resolvedUrl,
            }).catch(() => {});
        }

        console.log(`[resolveUrl] Resolved to: ${resolvedUrl}`);
        return Response.json({ url: resolvedUrl });

    } catch (error) {
        console.error('[resolveUrl] Error:', error.message);
        return Response.json({ error: 'Failed to resolve URL. Please try again.' }, { status: 500 });
    }
});