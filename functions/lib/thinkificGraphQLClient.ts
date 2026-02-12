const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

async function graphQLQuery(query, variables = {}) {
    if (!API_ACCESS_TOKEN) {
        throw new Error('THINKIFIC_API_ACCESS_TOKEN not configured');
    }

    const url = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/graphql`;
    
    console.log(`[GraphQL] POST ${url}`);
    console.log(`[GraphQL] Query:`, query.substring(0, 200) + '...');
    console.log(`[GraphQL] Variables:`, JSON.stringify(variables));

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
        },
        body: JSON.stringify({
            query,
            variables
        })
    });

    const status = response.status;
    const body = await response.json();

    console.log(`[GraphQL] Response status: ${status}`);

    if (body.errors) {
        console.error(`[GraphQL] Errors:`, JSON.stringify(body.errors, null, 2));
    }

    if (status >= 400) {
        console.error(`[GraphQL] HTTP ${status}:`, JSON.stringify(body, null, 2));
        throw new Error(`GraphQL HTTP ${status}: ${body.errors?.[0]?.message || 'Unknown error'}`);
    }

    return { status, data: body.data, errors: body.errors };
}

export { graphQLQuery };