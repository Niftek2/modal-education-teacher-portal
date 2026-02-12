const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

Deno.serve(async (req) => {
    try {
        const response = await fetch("https://api.thinkific.com/stable/graphql", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                query: `
                    query GetUserSchema {
                        __type(name: "User") {
                            name
                            kind
                            fields(includeDeprecated: false) {
                                name
                                type {
                                    kind
                                    name
                                    ofType {
                                        kind
                                        name
                                    }
                                }
                            }
                        }
                    }
                `
            })
        });

        const text = await response.text();
        const data = JSON.parse(text);
        
        return Response.json(data, { status: 200 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});