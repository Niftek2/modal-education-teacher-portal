import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const GRAPHQL_URL = "https://api.thinkific.com/stable/graphql";

async function graphQLQuery(query, variables = {}) {
    if (!API_ACCESS_TOKEN) {
        throw new Error('THINKIFIC_API_ACCESS_TOKEN not configured');
    }

    console.log(`[SCHEMA] POST ${GRAPHQL_URL}`);
    console.log(`[SCHEMA] Query:`, query.substring(0, 150));

    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const status = response.status;
    const text = await response.text();
    console.log(`[SCHEMA] Status: ${status}, response length: ${text.length}`);

    if (status >= 400) {
        console.error(`[SCHEMA] Error response:`, text.substring(0, 500));
        throw new Error(`GraphQL HTTP ${status}: ${text.substring(0, 200)}`);
    }

    let body;
    try {
        body = JSON.parse(text);
    } catch (e) {
        console.error(`[SCHEMA] Failed to parse JSON:`, text.substring(0, 500));
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
    }

    if (body.errors) {
        console.error(`[SCHEMA] GraphQL errors:`, JSON.stringify(body.errors, null, 2));
        throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
    }

    return body.data;
}

Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') {
            return Response.json({ error: 'POST required' }, { status: 405 });
        }

        console.log(`\n[SCHEMA] ========== INTROSPECTION START ==========\n`);

        // Step A: Get root Query fields
        console.log(`[SCHEMA] Step A: Fetching root Query fields...`);
        const rootQueryFields = await graphQLQuery(`
            query IntrospectRootQuery {
                __schema {
                    queryType {
                        fields {
                            name
                        }
                    }
                }
            }
        `);

        const fieldNames = rootQueryFields?.__schema?.queryType?.fields?.map(f => f.name) || [];
        console.log(`[SCHEMA] Root fields count: ${fieldNames.length}`);
        console.log(`[SCHEMA] Fields:`, fieldNames.join(', '));

        // Step B: Identify activity-related types
        const activityKeywords = ['user', 'enrollment', 'course', 'progress', 'completed', 'completion', 'content', 'quiz', 'attempt', 'assessment'];
        const relevantFields = fieldNames.filter(name => 
            activityKeywords.some(keyword => name.toLowerCase().includes(keyword))
        );

        console.log(`[SCHEMA] Step B: Relevant fields for activity:`, relevantFields.join(', '));

        // Step C: Introspect each relevant type
        const typeSchemas = {};
        for (const fieldName of relevantFields) {
            try {
                console.log(`[SCHEMA] Introspecting type from field: ${fieldName}`);
                
                // Get the field's return type name
                const fieldInfoQuery = `
                    query GetFieldInfo {
                        __type(name: "Query") {
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

                const typeInfo = await graphQLQuery(fieldInfoQuery);
                const field = typeInfo?.__type?.fields?.find(f => f.name === fieldName);
                
                if (field) {
                    // Extract the actual type name
                    let typeName = field.type.name;
                    if (!typeName && field.type.ofType) {
                        typeName = field.type.ofType.name;
                    }
                    if (!typeName && field.type.ofType?.ofType) {
                        typeName = field.type.ofType.ofType.name;
                    }

                    if (typeName) {
                        console.log(`[SCHEMA] Field ${fieldName} returns type: ${typeName}`);

                        // Now introspect that type
                        const detailedQuery = `
                            query GetTypeDetail {
                                __type(name: "${typeName}") {
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

                        const typeDetails = await graphQLQuery(detailedQuery);
                        typeSchemas[fieldName] = {
                            typeName,
                            type: typeDetails?.__type
                        };
                        console.log(`[SCHEMA]   ✓ Introspected ${typeName}`);
                    }
                }
            } catch (err) {
                console.error(`[SCHEMA] Error introspecting ${fieldName}:`, err.message);
                typeSchemas[fieldName] = { error: err.message };
            }
        }

        console.log(`\n[SCHEMA] ========== INTROSPECTION COMPLETE ==========\n`);

        return Response.json({
            rootQueryFields: fieldNames,
            relevantFields,
            typeSchemas,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[SCHEMA] Fatal error:', error);
        return Response.json({
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});