// Custom API client that doesn't depend on Base44 auth
const APP_ID = '698c9549de63fc919dec560c';
const BASE_URL = `/api/apps/${APP_ID}/functions`;

async function doFetch(functionName, payload, sessionToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    return fetch(`${BASE_URL}/${functionName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
}

export const api = {
    async call(functionName, payload, sessionToken) {
        let response = await doFetch(functionName, payload, sessionToken);

        // On 401, retry once with a fresh token from localStorage before giving up
        if (response.status === 401) {
            const freshToken = localStorage.getItem('modal_math_session');
            if (freshToken && freshToken !== sessionToken) {
                response = await doFetch(functionName, payload, freshToken);
            }
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.json();
    }
};