// Thinkific API Client with pagination, retries, and logging
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const BASE_URL = "https://api.thinkific.com/api/public/v1";

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(endpoint, options = {}) {
    const { method = 'GET', body, retries = 3, params = {} } = options;
    
    const url = new URL(`${BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.append(key, value);
        }
    });

    const headers = {
        'X-Auth-API-Key': THINKIFIC_API_KEY,
        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
        'Content-Type': 'application/json'
    };

    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const requestId = crypto.randomUUID();
            console.log(`[${requestId}] ${method} ${url.pathname}${url.search}`);
            
            const response = await fetch(url.toString(), {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined
            });

            console.log(`[${requestId}] Status: ${response.status}`);

            if (response.status === 429) {
                const waitTime = Math.pow(2, attempt) * 1000;
                console.log(`[${requestId}] Rate limited, waiting ${waitTime}ms`);
                await sleep(waitTime);
                continue;
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[${requestId}] Error: ${errorText}`);
                
                if (response.status >= 500 && attempt < retries - 1) {
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.log(`[${requestId}] Server error, retrying in ${waitTime}ms`);
                    await sleep(waitTime);
                    continue;
                }
                
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const itemCount = data.items?.length || (Array.isArray(data) ? data.length : 1);
            console.log(`[${requestId}] Success: ${itemCount} items returned`);
            
            return data;
        } catch (error) {
            lastError = error;
            if (attempt < retries - 1) {
                const waitTime = Math.pow(2, attempt) * 1000;
                console.log(`Attempt ${attempt + 1} failed, retrying in ${waitTime}ms: ${error.message}`);
                await sleep(waitTime);
            }
        }
    }
    
    throw lastError;
}

async function paginate(endpoint, params = {}) {
    const allItems = [];
    let page = 1;
    const limit = 100;

    while (true) {
        const data = await makeRequest(endpoint, {
            params: { ...params, page, limit }
        });

        const items = data.items || [];
        allItems.push(...items);

        console.log(`Page ${page}: ${items.length} items (total: ${allItems.length})`);

        if (items.length < limit) {
            break;
        }
        page++;
    }

    return allItems;
}

export const ThinkificClient = {
    // Users
    async getUserByEmail(email) {
        const users = await paginate('/users', { 'query[email]': email });
        return users[0] || null;
    },

    async getUserById(userId) {
        return await makeRequest(`/users/${userId}`);
    },

    async getGroupUsers(groupId) {
        return await paginate('/users', { 'query[group_id]': groupId });
    },

    // Groups
    async getGroups() {
        return await paginate('/groups');
    },

    async getGroup(groupId) {
        return await makeRequest(`/groups/${groupId}`);
    },

    // Enrollments
    async getEnrollmentsByUser(userId) {
        return await paginate('/enrollments', { 'query[user_id]': userId });
    },

    async getEnrollmentsByCourse(courseId) {
        return await paginate('/enrollments', { 'query[course_id]': courseId });
    },

    // Course Progress
    async getCourseProgress(userId, courseId) {
        const progress = await paginate('/course_progress', {
            'query[user_id]': userId,
            'query[course_id]': courseId
        });
        return progress[0] || null;
    },

    async getAllCourseProgressForUser(userId) {
        return await paginate('/course_progress', { 'query[user_id]': userId });
    },

    // Products (for bundle verification)
    async getProducts() {
        return await paginate('/products');
    },

    // Events (for signin tracking)
    async getUserEvents(userId, eventName = null) {
        const params = { 'query[user_id]': userId };
        if (eventName) {
            params['query[name]'] = eventName;
        }
        return await paginate('/events', params);
    },

    // Diagnostic test
    async diagnosticTest() {
        console.log('=== THINKIFIC API DIAGNOSTIC TEST ===');
        
        const tests = [
            { name: 'Groups', fn: () => this.getGroups() },
            { name: 'Products', fn: () => this.getProducts() },
            { name: 'Sample User Events', fn: async () => {
                const users = await paginate('/users', { limit: 1 });
                if (users[0]) {
                    return await this.getUserEvents(users[0].id);
                }
                return [];
            }}
        ];

        const results = {};
        for (const test of tests) {
            try {
                const result = await test.fn();
                results[test.name] = {
                    success: true,
                    count: result.length,
                    sample: result[0] || null
                };
            } catch (error) {
                results[test.name] = {
                    success: false,
                    error: error.message
                };
            }
        }

        console.log('=== DIAGNOSTIC RESULTS ===');
        console.log(JSON.stringify(results, null, 2));
        return results;
    }
};