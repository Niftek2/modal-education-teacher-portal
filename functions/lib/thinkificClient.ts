/**
 * Thinkific SDK Contract
 * 
 * Single point of contact for all Thinkific API calls.
 * Uses api.thinkific.com base URLs only.
 * Auth: Bearer token with THINKIFIC_API_ACCESS_TOKEN
 * 
 * Allowlisted REST paths:
 *   GET /users?query[email]=<email>
 *   GET /users/{id}
 *   GET /groups
 *   GET /group_users?query[group_id]=<groupId>
 *   GET /enrollments?query[user_id]=<userId>
 *   GET /enrollments?query[user_id]=<userId>&query[course_id]=<courseId>
 *   GET /courses/{id}
 *   GET /courses (list all courses)
 *   GET /chapters?query[course_id]=<courseId>
 *   GET /contents?query[chapter_id]=<chapterId>
 */

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const REST_BASE = "https://api.thinkific.com/api/public/v1";
const GRAPHQL_ENDPOINT = "https://api.thinkific.com/stable/graphql";

// Allowlist: match exact endpoint patterns
const ALLOWED_REST_PATTERNS = [
    /^\/users(\?|$)/,           // /users or /users?...
    /^\/users\/\d+(\?|$)/,      // /users/{id} or /users/{id}?...
    /^\/groups(\?|$)/,          // /groups or /groups?...
    /^\/group_users(\?|$)/,     // /group_users or /group_users?...
    /^\/enrollments(\?|$)/,     // /enrollments or /enrollments?...
    /^\/enrollments\/\d+(\?|$)/,     // /enrollments/{id} for DELETE
    /^\/courses\/\d+(\?|$)/,    // /courses/{id} or /courses/{id}?...
    /^\/courses(\?|$)/,         // /courses or /courses?... (list all)
    /^\/chapters(\?|$)/,        // /chapters?query[course_id]=...
    /^\/contents(\?|$)/         // /contents?query[chapter_id]=...
];

function validateRestPath(path) {
    const pathOnly = path.split('?')[0];
    const allowed = ALLOWED_REST_PATTERNS.some(pattern => pattern.test(pathOnly));
    if (!allowed) {
        throw new Error(`Endpoint not allowlisted: ${pathOnly}`);
    }
}

export async function requestRest(path, method = 'GET', query = null, body = null) {
    validateRestPath(path);
    
    const url = new URL(path, REST_BASE);
    
    if (query) {
        Object.entries(query).forEach(([k, v]) => {
            url.searchParams.append(k, v);
        });
    }
    
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url.toString(), options);
    
    const contentType = response.headers.get("content-type") || "";
    const raw = await response.text();

    let data = null;
    if (raw && contentType.includes("application/json")) {
        try {
            data = JSON.parse(raw);
        } catch {
            data = { raw };
        }
    } else if (raw) {
        data = { raw };
    }
    
    return {
        status: response.status,
        ok: response.ok,
        data
    };
}

export async function requestGraphQL(query, variables = {}) {
    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
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
    const result = await requestRest('/group_users', 'GET', { 'query[group_id]': String(groupId) });
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
 * Delete an enrollment by ID
 */
export async function deleteEnrollment(enrollmentId) {
    const result = await requestRest(`/enrollments/${enrollmentId}`, 'DELETE');
    if (!result.ok) {
        throw new Error(`Failed to delete enrollment ${enrollmentId} (status ${result.status})`);
    }
    return true;
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

/**
 * Get Thinkific config info (for diagnostics)
 */
export function getConfig() {
    return {
        restBase: REST_BASE,
        graphqlEndpoint: GRAPHQL_ENDPOINT,
        allowedRestPatterns: ALLOWED_REST_PATTERNS.map(p => p.source)
    };
}