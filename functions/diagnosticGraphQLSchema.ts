const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

async function graphQLQuery(query, variables = {}) {
    const response = await fetch("https://api.thinkific.com/stable/graphql", {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    
    if (data.errors) {
        console.error('[SCHEMA] GraphQL Error:', JSON.stringify(data.errors, null, 2));
        throw new Error(`GraphQL Error: ${data.errors[0]?.message || 'Unknown error'}`);
    }
    
    if (!response.ok) {
        throw new Error(`GraphQL HTTP ${response.status}`);
    }
    
    return data.data;
}

async function introspectType(typeName) {
    const query = `
        query IntrospectType($name: String!) {
            __type(name: $name) {
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
                            ofType {
                                kind
                                name
                            }
                        }
                    }
                }
            }
        }
    `;
    
    return graphQLQuery(query, { name: typeName });
}

Deno.serve(async (req) => {
    try {
        console.log('[SCHEMA] ========== SCHEMA INTROSPECTION ==========');
        
        // Step 1: Get root query fields
        console.log('[SCHEMA] Fetching root query fields...');
        const rootQuery = await graphQLQuery(`
            query GetRootFields {
                __schema {
                    queryType {
                        fields(includeDeprecated: false) {
                            name
                        }
                    }
                }
            }
        `);
        
        const rootFields = rootQuery.__schema.queryType.fields.map(f => f.name);
        console.log('[SCHEMA] Root fields found:', rootFields);
        
        // Step 2: Identify activity-related types
        const activityKeywords = ['user', 'enrollment', 'course', 'progress', 'completed', 'content', 'quiz', 'attempt', 'assessment'];
        const relevantFields = rootFields.filter(name => 
            activityKeywords.some(keyword => name.toLowerCase().includes(keyword))
        );
        
        console.log('[SCHEMA] Activity-related root fields:', relevantFields);
        
        // Step 3: Introspect each relevant type
        const schemas = {};
        for (const fieldName of relevantFields) {
            // Convert field name to type name (e.g., "user" -> "User", "users" -> "User")
            const typeName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1).replace(/s$/, '');
            
            try {
                console.log(`[SCHEMA] Introspecting type: ${typeName}`);
                const typeSchema = await introspectType(typeName);
                
                if (typeSchema.__type) {
                    schemas[typeName] = typeSchema.__type;
                    console.log(`[SCHEMA] ✓ Type found: ${typeName}`);
                } else {
                    console.log(`[SCHEMA] ✗ Type not found: ${typeName}`);
                }
            } catch (error) {
                console.error(`[SCHEMA] Failed to introspect ${typeName}:`, error.message);
            }
        }
        
        // Also try some common related types
        const commonTypes = ['UserCourseEnrollment', 'Progress', 'CompletedContent', 'QuizAttempt', 'Quiz', 'Lesson'];
        console.log('[SCHEMA] Checking common related types...');
        
        for (const typeName of commonTypes) {
            try {
                const typeSchema = await introspectType(typeName);
                if (typeSchema.__type) {
                    schemas[typeName] = typeSchema.__type;
                    console.log(`[SCHEMA] ✓ Type found: ${typeName}`);
                }
            } catch (error) {
                // Silently skip
            }
        }
        
        console.log('[SCHEMA] ========== INTROSPECTION COMPLETE ==========');
        
        return Response.json({
            rootFields,
            relevantFields,
            schemas
        }, { status: 200 });
        
    } catch (error) {
        console.error('[SCHEMA] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});