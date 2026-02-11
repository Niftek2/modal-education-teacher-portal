const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

Deno.serve(async (req) => {
    try {
        const response = await fetch('https://api.thinkific.com/api/public/v1/groups/553461', {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        console.log('Full group response:', JSON.stringify(data, null, 2));
        
        return Response.json(data);

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});