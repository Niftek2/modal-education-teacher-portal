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
        // Check User.courses return type
        const result = await graphQLQuery(`
            query ExploreUser {
                __type(name: "User") {
                    fields(includeDeprecated: false) {
                        name
                        args { name type { kind name } }
                        type {
                            kind
                            name
                            ofType {
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
            }
        `);
        
        // Extract only courses-related info
        const userFields = result.__type.fields;
        const coursesField = userFields.find(f => f.name === 'courses');
        const other = userFields.slice(0, 5);
        
        return Response.json({
            coursesField,
            sampleUserFields: other.map(f => ({ name: f.name, typeName: f.type.ofType?.name || f.type.name }))
        }, { status: 200 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});