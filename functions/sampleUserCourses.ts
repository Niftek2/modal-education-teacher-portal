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
        // Fetch Weston's courses and see what fields are available
        const result = await graphQLQuery(`
            query SampleUserCourses($userId: ID!) {
                user(gid: $userId) {
                    gid
                    email
                    firstName
                    lastName
                    courses(first: 3) {
                        edges {
                            node {
                                id
                                name
                                curriculum {
                                    chapters(first: 1) {
                                        edges {
                                            node {
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                            cursor
                        }
                    }
                }
            }
        `, { userId: "236589658" });
        
        return Response.json(result, { status: 200 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});