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
            lessonId,
            fullData: data,
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});