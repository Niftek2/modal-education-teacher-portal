const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const courseId = '422595';
        
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/courses/${courseId}/curriculum`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        const status = response.status;
        const text = await response.text();
        
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }

        return Response.json({
            status,
            isOk: response.ok,
            hasData: !!data,
            dataKeys: data ? Object.keys(data) : null,
            firstItem: data?.items?.[0] || null,
            fullData: data
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});