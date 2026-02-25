const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const body = await req.json().catch(() => ({}));
        const chapterId = body.chapterId || '1745945'; // "Shapes and Colors" chapter from PK course

        const url = `https://api.thinkific.com/api/public/v1/chapters/${chapterId}/contents`;
        console.log('Fetching:', url);
        
        const response = await fetch(url, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json',
            }
        });

        const status = response.status;
        const text = await response.text();
        console.log('Status:', status, 'Body length:', text.length);
        
        let data = null;
        try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }

        return Response.json({ status, url, chapterId, data });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});