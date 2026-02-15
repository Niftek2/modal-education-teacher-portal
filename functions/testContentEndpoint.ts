const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const courseId = '422595';
        const contentId = '9473473'; // First content_id from debug
        
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/courses/${courseId}/contents/${contentId}`,
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
            responseText: text,
            parsedData: data
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});