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
        // Check if UserEnrollment or similar exists
        const types = ['Enrollment', 'UserEnrollment', 'UserCourseEnrollment', 'CourseUser'];
        const results = {};
        
        for (const typeName of types) {
            try {
                const result = await graphQLQuery(`
                    query ExploreType {
                        __type(name: "${typeName}") {
                            name
                            fields(includeDeprecated: false) {
                                name
                            }
                        }
                    }
                `);
                
                if (result.__type) {
                    results[typeName] = result.__type.fields.map(f => f.name);
                }
            } catch (e) {
                // Type doesn't exist
            }
        }
        
        // Also check what User fields relate to courses
        const userFields = await graphQLQuery(`
            query UserFields {
                __type(name: "User") {
                    fields(includeDeprecated: false) {
                        name
                    }
                }
            }
        `);
        
        const enrollmentKeywords = userFields.__type.fields
            .filter(f => f.name.toLowerCase().includes('enroll') || 
                         f.name.toLowerCase().includes('course') ||
                         f.name.toLowerCase().includes('progress'))
            .map(f => f.name);
        
        return Response.json({
            foundTypes: results,
            userEnrollmentKeywords: enrollmentKeywords
        }, { status: 200 });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});