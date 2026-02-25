const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const body = await req.json().catch(() => ({}));
        const chapterId = body.chapterId || '1745945'; // "Shapes and Colors" chapter from PK course

        // Try the lesson directly
        const lessonId = '6399756';
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/lessons/${lessonId}`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
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
            chapterId,
            itemCount: data?.items?.length || 0,
            // Show full first item to see all available fields
            firstItem: data?.items?.[0] || null,
            allItemIds: data?.items?.map(i => ({ id: i.id, name: i.name, free_path: i.free_path, slug: i.slug })) || [],
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});