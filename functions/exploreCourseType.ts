const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

async function graphQLQuery(query) {
    const response = await fetch("https://api.thinkific.com/stable/graphql", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
    });

    const data = await response.json();
    if (data.errors) throw new Error(data.errors[0]?.message);
    return data.data;
}

Deno.serve(async (req) => {
    try {
        const result = await graphQLQuery(`
            query {
                __type(name: "Course") {
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
        `);
        
        return Response.json(result, { status: 200 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});