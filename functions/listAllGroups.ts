const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

Deno.serve(async (req) => {
    try {
        const response = await fetch('https://api.thinkific.com/api/public/v1/groups', {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch groups: ${response.status}`);
        }
        
        const data = await response.json();
        const groups = data.items || [];
        
        return Response.json({
            total: groups.length,
            groups: groups.map(g => ({
                id: g.id,
                name: g.name
            }))
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});