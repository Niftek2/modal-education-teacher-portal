/**
 * Thinkific SDK Contract
 * 
 * Single point of contact for all Thinkific API calls.
 * Restricts to only documented endpoints in Thinkific Admin API.
 * Uses API Access Token (Bearer) authentication.
 */

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

// Whitelist of allowed REST endpoint prefixes (documented in Thinkific Admin API)
const ALLOWED_ENDPOINTS = [
    '/users',
    '/groups',
    '/group_users',
    '/group_analysts',
    '/enrollments',
    '/courses',
    '/chapters',
    '/contents'
];

function validateRestPath(path) {
    const allowed = ALLOWED_ENDPOINTS.some(prefix => path.startsWith(prefix));
    if (!allowed) {
        throw new Error(`Endpoint not allowed by SDK contract: ${path}. Allowed: ${ALLOWED_ENDPOINTS.join(', ')}`);
    }
}

export async function requestRest(path, method = 'GET', query = null, body = null) {
    validateRestPath(path);
    
    const url = new URL(path, `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/api/public/v1`);
    
    if (query) {
        Object.entries(query).forEach(([k, v]) => {
            url.searchParams.append(k, v);
        });
    }
    
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
            'Content-Type': 'application/json'
        }
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url.toString(), options);
    const data = await response.json();
    
    return {
        status: response.status,
        ok: response.ok,
        data
    };
}

export async function requestGraphQL(query, variables = {}) {
    const url = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/graphql`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query,
            variables
        })
    });
    
    const data = await response.json();
    
    if (data.errors) {
        throw new Error(`GraphQL error: ${data.errors.map(e => e.message).join('; ')}`);
    }
    
    return {
        status: response.status,
        ok: response.ok,
        data: data.data
    };
}

/**
 * Fetch a user by ID
 */
export async function getUser(userId) {
    const result = await requestRest(`/users/${userId}`);
    if (!result.ok) throw new Error(`User not found: ${userId}`);
    return result.data;
}

/**
 * Find a user by email
 */
export async function findUserByEmail(email) {
    const result = await requestRest('/users', 'GET', { 'query[email]': email });
    const users = result.data.items || [];
    return users.length > 0 ? users[0] : null;
}

/**
 * List all groups
 */
export async function listGroups() {
    const result = await requestRest('/groups');
    return result.data.items || [];
}

/**
 * List users in a group
 */
export async function listGroupUsers(groupId) {
    const result = await requestRest('/users', 'GET', { 'query[group_id]': groupId });
    return result.data.items || [];
}

/**
 * List all enrollments, optionally filtered
 */
export async function listEnrollments(filters = {}) {
    const result = await requestRest('/enrollments', 'GET', filters);
    return result.data.items || [];
}

/**
 * Get a course by ID
 */
export async function getCourse(courseId) {
    const result = await requestRest(`/courses/${courseId}`);
    if (!result.ok) throw new Error(`Course not found: ${courseId}`);
    return result.data;
}

/**
 * Check if endpoint is available (for capabilities check)
 */
export async function checkEndpoint(path, method = 'GET') {
    try {
        validateRestPath(path);
        const result = await requestRest(path, method);
        return { available: result.ok, status: result.status };
    } catch (error) {
        return { available: false, error: error.message };
    }
}