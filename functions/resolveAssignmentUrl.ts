import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Resolves a canonical slug-based Thinkific URL for a given lesson or quiz.
 *
 * Strategy:
 * A) If cached contentUrl is valid (slug-based, not numeric), return it immediately.
 * B) Fetch the individual content item directly from Thinkific by contentType + contentId:
 *    - quiz: GET /contents/{contentId}  → read free_path (contains /quizzes/{id}-{slug})
 *    - lesson: GET /contents/{contentId} → read free_path (contains /lessons/{id}-{slug})
 *    The /contents/{id} endpoint returns free_path for both lessons and quizzes.
 * C) Validate the resolved URL:
 *    - Must NOT match /\/courses\/take\/\d+(\/|$)/
 *    - Must contain "/quizzes/" if contentType=quiz, "/lessons/" if contentType=lesson
 * D) Persist to StudentAssignment.contentUrl and AssignmentCatalog.contentUrl.
 * E) Return finalUrl or 404 if unresolvable.
 */

const DOMAIN = 'https://learn.modaleducation.com';
const NUMERIC_TAKE = /\/courses\/take\/\d+(\/|$)/;

const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');
const REST_BASE = 'https://api.thinkific.com/api/public/v1';

async function thinkificGet(path) {
    const url = `${REST_BASE}${path}`;
    const res = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json',
        },
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = {}; }
    return { ok: res.ok, status: res.status, data };
}

/**
 * Fetch free_path for a content item (lesson or quiz) by contentId.
 * Tries /contents/{id} directly first (works for both lessons and quizzes).
 * Falls back to walking course chapters if direct fetch fails.
 */
async function resolveFreePath(courseId, contentType, contentId) {
    // Direct fetch: GET /contents/{contentId}
    // take_url is a full URL (may use any domain) — always extract path only, then rebuild with DOMAIN.
    // free_path is a path string — use as fallback.
    const direct = await thinkificGet(`/contents/${contentId}`);
    if (direct.ok && direct.data) {
        const path = extractPath(direct.data.take_url) || extractPath(direct.data.free_path) || null;
        if (path) {
            console.log(`[resolveUrl] Direct /contents/${contentId} → path=${path}`);
            return path;
        }
    }
    console.log(`[resolveUrl] Direct /contents/${contentId} returned no usable path (status=${direct.status}), falling back to chapter walk`);

    // Fallback: walk chapters to find this contentId
    const chaptersRes = await thinkificGet(`/courses/${courseId}/chapters`);
    if (!chaptersRes.ok) {
        console.warn(`[resolveUrl] /courses/${courseId}/chapters failed: ${chaptersRes.status}`);
        return null;
    }

    const chapterIds = (chaptersRes.data?.items || []).map(c => c.id);
    console.log(`[resolveUrl] Walking ${chapterIds.length} chapters for courseId=${courseId}`);

    for (const chapterId of chapterIds) {
        const contentsRes = await thinkificGet(`/chapters/${chapterId}/contents`);
        if (!contentsRes.ok) continue;
        const items = contentsRes.data?.items || [];
        for (const item of items) {
            if (String(item.id) === String(contentId)) {
                const path = extractPath(item.take_url) || extractPath(item.free_path) || null;
                console.log(`[resolveUrl] Chapter walk found id=${item.id} path=${path}`);
                return path;
            }
        }
    }

    return null;
}

/**
 * Extracts the canonical path from a Thinkific URL (take_url or free_path).
 * Always strips any domain and returns just the pathname.
 */
function extractPath(urlOrPath) {
    if (!urlOrPath) return null;
    try {
        return new URL(urlOrPath).pathname;
    } catch {
        // Already a path
        return urlOrPath.startsWith('/') ? urlOrPath : null;
    }
}

/**
 * Validates the final URL against all hard rules:
 * - Must start with our canonical DOMAIN
 * - Must NOT be a numeric take URL
 * - Path must contain /quizzes/{contentId}- for quizzes
 * - Path must contain /lessons/{contentId}- for lessons
 */
function validateUrl(finalUrl, contentType, contentId) {
    if (!finalUrl) return false;
    if (!finalUrl.startsWith(DOMAIN)) return false;
    if (NUMERIC_TAKE.test(finalUrl)) return false;
    if (contentType === 'quiz' && !finalUrl.includes(`/quizzes/${contentId}-`)) return false;
    if (contentType === 'lesson' && !finalUrl.includes(`/lessons/${contentId}-`)) return false;
    return true;
}

Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);

    let assignmentId, catalogId, courseId, contentType, contentId;
    try {
        const body = await req.json();
        assignmentId = body.assignmentId;
        catalogId    = body.catalogId;
        courseId     = body.courseId;
        contentType  = body.contentType; // 'lesson' or 'quiz'
        contentId    = body.contentId;   // numeric lessonId or quizId
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!contentId || !courseId || !contentType) {
        return Response.json(
            { error: 'courseId, contentType, and contentId are required' },
            { status: 400 }
        );
    }

    console.log(`[resolveUrl] courseId=${courseId} contentType=${contentType} contentId=${contentId} assignmentId=${assignmentId} catalogId=${catalogId}`);

    try {
        // Step A: Return cached slug URL if already valid
        if (assignmentId) {
            const rows = await base44.asServiceRole.entities.StudentAssignment.filter({ id: assignmentId });
            const cached = rows?.[0]?.contentUrl;
            if (validateUrl(cached, contentType, contentId)) {
                console.log(`[resolveUrl] Returning cached URL: ${cached}`);
                return Response.json({ url: cached });
            }
        }

        // Step B: Resolve free_path from Thinkific
        const freePath = await resolveFreePath(courseId, contentType, contentId);

        if (!freePath) {
            console.warn(`[resolveUrl] free_path not found for courseId=${courseId} contentType=${contentType} contentId=${contentId}`);
            return Response.json(
                { error: 'Unable to resolve assignment URL: content not found in Thinkific.' },
                { status: 404 }
            );
        }

        const finalUrl = `${DOMAIN}${freePath}`;

        // Step C: Validate — path must contain /quizzes/{contentId}- or /lessons/{contentId}-
        if (!validateUrl(finalUrl, contentType, contentId)) {
            console.error(`[resolveUrl] Validation failed for contentType=${contentType} contentId=${contentId}: ${finalUrl}`);
            return Response.json(
                { error: `Resolved URL failed validation for content type "${contentType}" id=${contentId}: ${finalUrl}` },
                { status: 404 }
            );
        }

        console.log(`[resolveUrl] Resolved: ${finalUrl}`);

        // Step D: Persist to BOTH StudentAssignment.contentUrl and AssignmentCatalog.contentUrl (non-fatal)
        if (assignmentId) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignmentId, {
                contentUrl: finalUrl,
            }).catch(e => console.warn('[resolveUrl] StudentAssignment update failed:', e.message));
        }
        if (catalogId) {
            await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, {
                contentUrl: finalUrl,
                thinkificUrl: finalUrl,
            }).catch(e => console.warn('[resolveUrl] AssignmentCatalog update failed:', e.message));
        }

        // Step E: Return
        return Response.json({ url: finalUrl });

    } catch (error) {
        console.error('[resolveUrl] Unexpected error:', error.message);
        return Response.json({ error: 'Failed to resolve URL. Please try again.' }, { status: 500 });
    }
});