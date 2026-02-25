const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');
const REST_BASE = 'https://api.thinkific.com/api/public/v1';

async function thinkificGet(path) {
    const res = await fetch(`${REST_BASE}${path}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json',
        }
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
    try {
        const body = await req.json().catch(() => ({}));
        const contentId = body.contentId || '8191235';
        const courseId = body.courseId || '496294';

        // 1. Direct /contents/{id}
        const direct = await thinkificGet(`/contents/${contentId}`);
        console.log(`/contents/${contentId} → ${direct.status}`);
        console.log('fields:', JSON.stringify(Object.keys(direct.data || {})));
        console.log('free_path:', direct.data?.free_path);
        console.log('content_type:', direct.data?.content_type);
        console.log('contentable_type:', direct.data?.contentable_type);

        // 2. Try /courses/{courseId}/chapters to find which chapters have content
        const chapters = await thinkificGet(`/courses/${courseId}/chapters`);
        const chapterItems = chapters.data?.items || [];
        console.log(`Course ${courseId} has ${chapterItems.length} chapters`);

        // 3. Check the first chapter's contents for structure
        let sampleContent = null;
        if (chapterItems.length > 0) {
            const firstChapter = chapterItems[0];
            const cc = await thinkificGet(`/chapters/${firstChapter.id}/contents`);
            const firstItems = cc.data?.items || [];
            sampleContent = firstItems[0] || null;
            console.log(`Chapter ${firstChapter.id} content[0] fields:`, JSON.stringify(Object.keys(sampleContent || {})));
            console.log(`Chapter ${firstChapter.id} content[0] sample:`, JSON.stringify(sampleContent));
        }

        return Response.json({
            directContentId: contentId,
            directStatus: direct.status,
            directData: direct.data,
            chapterCount: chapterItems.length,
            sampleChapterContent: sampleContent,
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});