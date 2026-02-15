const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const courseId = '422595'; // PK course
        
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/courses/${courseId}/chapters`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        const status = response.status;
        const data = await response.json();

        return Response.json({
            status,
            rawResponse: data,
            hasItems: !!data.items,
            itemsCount: data.items?.length || 0,
            firstItem: data.items?.[0] || null
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});