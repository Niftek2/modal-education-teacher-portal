import * as thinkific from './lib/thinkificClient.js';

/**
 * Capabilities Diagnostic
 * 
 * Checks which Thinkific endpoints are available and returns results.
 * Helps determine what backfill strategy is feasible.
 */

Deno.serve(async (req) => {
    try {
        console.log('[DIAG] Starting Thinkific capabilities check...');
        
        const capabilities = {
            timestamp: new Date().toISOString(),
            rest: {
                users: { endpoint: '/users', status: null },
                groups: { endpoint: '/groups', status: null },
                groupUsers: { endpoint: '/users?query[group_id]=1', status: null },
                enrollments: { endpoint: '/enrollments', status: null },
                courses: { endpoint: '/courses', status: null }
            },
            graphql: {
                available: false,
                error: null
            },
            summary: null
        };
        
        // Check REST endpoints
        console.log('[DIAG] Checking REST endpoints...');
        
        for (const [key, endpoint] of Object.entries(capabilities.rest)) {
            try {
                const result = await thinkific.checkEndpoint(endpoint.endpoint);
                endpoint.status = result.status || (result.available ? 200 : 404);
                console.log(`[DIAG] ${endpoint.endpoint}: ${endpoint.status}`);
            } catch (error) {
                endpoint.status = 'ERROR';
                endpoint.error = error.message;
                console.log(`[DIAG] ${endpoint.endpoint}: ERROR - ${error.message}`);
            }
        }
        
        // Check GraphQL
        console.log('[DIAG] Checking GraphQL endpoint...');
        try {
            const result = await thinkific.requestGraphQL(`
                query {
                    __typename
                }
            `);
            
            if (result.ok && result.data) {
                capabilities.graphql.available = true;
                console.log('[DIAG] GraphQL: Available');
            }
        } catch (error) {
            capabilities.graphql.error = error.message;
            console.log(`[DIAG] GraphQL: ERROR - ${error.message}`);
        }
        
        // Generate summary
        const restAvailable = Object.values(capabilities.rest)
            .filter(e => e.status === 200).length;
        
        capabilities.summary = {
            restEndpointsWorking: restAvailable,
            graphqlWorking: capabilities.graphql.available,
            recommendation: capabilities.graphql.available 
                ? 'Use GraphQL for enriched data, fall back to REST for basic fields'
                : 'Use REST only; consider CSV import for historical quiz data if not available in REST'
        };
        
        console.log('[DIAG] Capabilities check complete');
        
        return Response.json(capabilities, { status: 200 });
    } catch (error) {
        console.error('[DIAG] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});