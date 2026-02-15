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
        
        // Try to get individual lesson/content details using content_ids
        const contentDetails = [];
        if (firstChapter?.content_ids && firstChapter.content_ids.length > 0) {
            const contentId = firstChapter.content_ids[0];
            
            // Try different endpoints for getting content details
            const endpoints = [
                `https://api.thinkific.com/api/public/v1/lessons/${contentId}`,
                `https://api.thinkific.com/api/public/v1/quizzes/${contentId}`,
                `https://api.thinkific.com/api/public/v1/content/${contentId}`
            ];
            
            for (const endpoint of endpoints) {
                const response = await fetch(endpoint, {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                    }
                });
                
                const status = response.status;
                let data = null;
                if (response.ok) {
                    data = await response.json();
                }
                
                contentDetails.push({
                    endpoint: endpoint,
                    status: status,
                    ok: response.ok,
                    data: data
                });
            }
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