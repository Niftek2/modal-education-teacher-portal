const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

Deno.serve(async (req) => {
    try {
        const courseId = '422595'; // PK course
        
        // Get chapters first
        const chaptersResponse = await fetch(
            `https://api.thinkific.com/api/public/v1/courses/${courseId}/chapters`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        const chaptersData = await chaptersResponse.json();
        const firstChapter = chaptersData.items?.[0];
        
        // Try the Contents endpoint (saw it in the API docs)
        const contentDetails = [];
        if (firstChapter?.content_ids && firstChapter.content_ids.length > 0) {
            const contentId = firstChapter.content_ids[0];
            
            // Try the Contents endpoint
            const contentsResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/contents/${contentId}`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                    }
                }
            );
            
            const status = contentsResponse.status;
            let data = null;
            if (contentsResponse.ok) {
                data = await contentsResponse.json();
            }
            
            contentDetails.push({
                endpoint: 'Contents API',
                status: status,
                ok: contentsResponse.ok,
                data: data,
                dataKeys: data ? Object.keys(data) : null
            });
        }

        return Response.json({
            chapters: {
                status: chaptersResponse.status,
                firstChapter: firstChapter,
                chapterKeys: firstChapter ? Object.keys(firstChapter) : null
            },
            contentEndpoints: contentDetails
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});