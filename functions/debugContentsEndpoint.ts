const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const body = await req.json().catch(() => ({}));
        const chapterId = body.chapterId || '1745945'; // "Shapes and Colors" chapter from PK course

        // Try contents endpoint with access token auth instead
        const ACCESS_TOKEN = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
        const chapterId2 = '1745945';
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/contents?query[chapter_id]=${chapterId2}`,
            {
                headers: {
                    'Authorization': `Bearer ${ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const status = response.status;
        const text = await response.text();
        let data = null;
        try { data = JSON.parse(text); } catch { data = null; }

        return Response.json({
            status,
            chapterId: chapterId2,
            authMethod: 'Bearer ACCESS_TOKEN',
            itemCount: data?.items?.length || 0,
            firstItem: data?.items?.[0] || null,
            allItems: data?.items?.map(i => ({ id: i.id, name: i.name, free_path: i.free_path, slug: i.slug })) || [],
            fullData: data,
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});