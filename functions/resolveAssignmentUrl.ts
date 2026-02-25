import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requestRest } from './lib/thinkificClient.js';

/**
 * Resolves a slug-based Thinkific URL for a given assignment.
 *
 * Steps:
 * A) If cached contentUrl is already slug-based, return immediately.
 * B) Fetch Thinkific content record and use free_path only.
 * C) Fail cleanly (404) if free_path unavailable — NEVER use numeric course IDs.
 * D) Persist resolved slug URL to StudentAssignment and AssignmentCatalog.
 *
 * Always uses https://learn.modaleducation.com as the domain.
 */

const NUMERIC_TAKE = /\/courses\/take\/\d+(\/|$)/;

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

    console.log(`[resolveUrl] Resolving: courseId=${courseId}, contentType=${contentType}, contentId=${contentId}, assignmentId=${assignmentId}, catalogId=${catalogId}`);

    try {
        // Step A: Check if the assignment already has a good slug-based URL cached
        if (assignmentId) {
            const existing = await base44.asServiceRole.entities.StudentAssignment.filter({ id: assignmentId });
            const cached = existing?.[0]?.contentUrl;
            if (cached && !NUMERIC_TAKE.test(cached)) {
                console.log(`[resolveUrl] Returning cached slug URL: ${cached}`);
                return Response.json({ url: cached });
            }
        }

        // Step B: Fetch Thinkific content record and use free_path only
        let contentData = null;
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
                        contentData = c;
                        break outerLoop;
                    }
                }
            }
        }

        console.log(`[resolveUrl] Content found: ${!!contentData}, free_path: ${contentData?.free_path || 'none'}`);

        // Step C: Only use free_path — never construct numeric URLs
        if (!contentData?.free_path) {
            console.warn(`[resolveUrl] No free_path for courseId=${courseId}, contentId=${contentId}`);
            return Response.json({ error: 'Unable to resolve assignment URL: content not found or free_path unavailable.' }, { status: 404 });
        }

        const resolvedUrl = `https://learn.modaleducation.com${contentData.free_path}`;

        // Guard: never persist or return a numeric take URL
        if (NUMERIC_TAKE.test(resolvedUrl)) {
            console.error(`[resolveUrl] Blocked numeric URL from free_path: ${resolvedUrl}`);
            return Response.json({ error: 'Resolved URL contains a numeric course ID, which is not allowed.' }, { status: 404 });
        }

        console.log(`[resolveUrl] Resolved to: ${resolvedUrl}`);

        // Step D: Persist to both StudentAssignment and AssignmentCatalog
        if (assignmentId) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignmentId, {
                contentUrl: resolvedUrl,
                thinkificUrl: resolvedUrl,
            }).catch(e => console.warn('[resolveUrl] Failed to update StudentAssignment:', e.message));
        }
        if (catalogId) {
            await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, {
                contentUrl: resolvedUrl,
                thinkificUrl: resolvedUrl,
            }).catch(e => console.warn('[resolveUrl] Failed to update AssignmentCatalog:', e.message));
        }

        return Response.json({ url: resolvedUrl });

    } catch (error) {
        console.error('[resolveUrl] Error:', error.message);
        return Response.json({ error: 'Failed to resolve URL. Please try again.' }, { status: 500 });
    }
});