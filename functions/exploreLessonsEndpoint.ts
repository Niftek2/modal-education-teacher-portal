const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const courseId = '422595'; // PK course
        
        // Try lessons endpoint
        const lessonsResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/courses/${courseId}/lessons`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        const lessonsStatus = lessonsResponse.status;
        const lessonsText = await lessonsResponse.text();
        let lessonsData;
        try {
            lessonsData = JSON.parse(lessonsText);
        } catch {
            lessonsData = null;
        }

        return Response.json({
            lessonsEndpoint: {
                status: lessonsStatus,
                ok: lessonsResponse.ok,
                data: lessonsData,
                firstItem: lessonsData?.items?.[0] || null
            }
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});