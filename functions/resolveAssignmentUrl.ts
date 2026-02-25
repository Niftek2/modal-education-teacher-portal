import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Resolves a slug-based Thinkific URL for a given assignment.
 *
 * A) If StudentAssignment already has a valid slug contentUrl, return it immediately.
 * B) Fetch Thinkific chapters+contents for courseId, find the item by contentId, read free_path.
 * C) Fail (404) if free_path is not available — NEVER use numeric course ID URLs.
 * D) Persist resolvedUrl to StudentAssignment and AssignmentCatalog.
 * E) Return resolvedUrl.
 */

const DOMAIN = 'https://learn.modaleducation.com';
const NUMERIC_TAKE = /\/courses\/take\/\d+(\/|$)/;

const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');
const REST_BASE = 'https://api.thinkific.com/api/public/v1';

async function thinkificGet(path, query = {}) {
    const url = new URL(`${REST_BASE}${path}`);
    for (const [k, v] of Object.entries(query)) {
        url.searchParams.append(k, String(v));
    }
    const res = await fetch(url.toString(), {
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
        // Step A: Return cached slug URL if already good
        if (assignmentId) {
            const rows = await base44.asServiceRole.entities.StudentAssignment.filter({ id: assignmentId });
            const cached = rows?.[0]?.contentUrl;
            if (cached && !NUMERIC_TAKE.test(cached) && cached.startsWith(DOMAIN)) {
                console.log(`[resolveUrl] Returning cached URL: ${cached}`);
                return Response.json({ url: cached });
            }
        }

        // Step B: Walk Thinkific chapters+contents to find free_path
        let freePath = null;

        const chaptersRes = await thinkificGet(`/courses/${courseId}/chapters`);
        if (!chaptersRes.ok) {
            console.warn(`[resolveUrl] Thinkific /courses/${courseId}/chapters failed: ${chaptersRes.status}`);
            return Response.json({ error: 'Could not reach Thinkific API.' }, { status: 502 });
        }

        const chapters = chaptersRes.data?.items || [];
        console.log(`[resolveUrl] Got ${chapters.length} chapters for courseId=${courseId}`);

        outer:
        for (const chapter of chapters) {
            const contentsRes = await thinkificGet('/contents', { 'query[chapter_id]': String(chapter.id) });
            if (!contentsRes.ok) continue;
            const contents = contentsRes.data?.items || [];
            for (const c of contents) {
                if (String(c.id) === String(contentId)) {
                    freePath = c.free_path || null;
                    console.log(`[resolveUrl] Found content id=${c.id} free_path=${freePath}`);
                    break outer;
                }
            }
        }

        // Step C: Fail cleanly if no free_path
        if (!freePath) {
            console.warn(`[resolveUrl] free_path not found for courseId=${courseId} contentId=${contentId}`);
            return Response.json(
                { error: 'Unable to resolve assignment URL: free_path not available for this content.' },
                { status: 404 }
            );
        }

        const resolvedUrl = `${DOMAIN}${freePath}`;

        // Extra guard: reject if free_path itself contained a numeric course ID
        if (NUMERIC_TAKE.test(resolvedUrl)) {
            console.error(`[resolveUrl] Blocked numeric URL: ${resolvedUrl}`);
            return Response.json(
                { error: 'Resolved URL still contains a numeric course ID — cannot open.' },
                { status: 404 }
            );
        }

        console.log(`[resolveUrl] Resolved: ${resolvedUrl}`);

        // Step D: Persist to DB (non-fatal)
        if (assignmentId) {
            await base44.asServiceRole.entities.StudentAssignment.update(assignmentId, {
                contentUrl: resolvedUrl,
                thinkificUrl: resolvedUrl,
            }).catch(e => console.warn('[resolveUrl] StudentAssignment update failed:', e.message));
        }
        if (catalogId) {
            await base44.asServiceRole.entities.AssignmentCatalog.update(catalogId, {
                contentUrl: resolvedUrl,
                thinkificUrl: resolvedUrl,
            }).catch(e => console.warn('[resolveUrl] AssignmentCatalog update failed:', e.message));
        }

        // Step E: Return
        return Response.json({ url: resolvedUrl });

    } catch (error) {
        console.error('[resolveUrl] Unexpected error:', error.message);
        return Response.json({ error: 'Failed to resolve URL. Please try again.' }, { status: 500 });
    }
});