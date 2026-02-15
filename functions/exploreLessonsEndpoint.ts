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
        
        // Try to get individual chapter details
        let chapterDetailData = null;
        if (firstChapter?.id) {
            const chapterDetailResponse = await fetch(
                `https://api.thinkific.com/api/public/v1/chapters/${firstChapter.id}`,
                {
                    headers: {
                        'X-Auth-API-Key': THINKIFIC_API_KEY,
                        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                    }
                }
            );
            
            if (chapterDetailResponse.ok) {
                chapterDetailData = await chapterDetailResponse.json();
            }
        }

        return Response.json({
            chapters: {
                status: chaptersResponse.status,
                firstChapter: firstChapter,
                chapterKeys: firstChapter ? Object.keys(firstChapter) : null
            },
            chapterDetail: {
                attempted: !!firstChapter?.id,
                chapterId: firstChapter?.id,
                data: chapterDetailData
            }
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});