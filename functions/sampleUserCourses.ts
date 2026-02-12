const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

async function graphQLQuery(query, variables) {
    const response = await fetch("https://api.thinkific.com/stable/graphql", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    if (data.errors) throw new Error(JSON.stringify(data.errors));
    return data.data;
}

Deno.serve(async (req) => {
    try {
        // Try different user lookup approaches
        console.log('[SAMPLE] Trying user lookup...');
        
        let result;
        try {
            result = await graphQLQuery(`
                query SampleByGid {
                    user(gid: "236589658") {
                        gid
                        email
                    }
                }
            `);
            console.log('[SAMPLE] GID lookup result:', result);
        } catch (e) {
            console.log('[SAMPLE] GID lookup failed:', e.message);
        }
        
        try {
            result = await graphQLQuery(`
                query SampleByUserEmail {
                    userByEmail(email: "weston@runningtech.net") {
                        gid
                        email
                    }
                }
            `);
            console.log('[SAMPLE] Email lookup result:', result);
        } catch (e) {
            console.log('[SAMPLE] Email lookup failed:', e.message);
        }
        
        return Response.json(result, { status: 200 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});