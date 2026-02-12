// Custom API client that doesn't depend on Base44 auth
const APP_ID = '698c9549de63fc919dec560c';
const BASE_URL = `/api/apps/${APP_ID}/functions`;

export const api = {
    async call(functionName, payload, sessionToken) {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (sessionToken) {
            headers['Authorization'] = `Bearer ${sessionToken}`;
        }
        
        const response = await fetch(`${BASE_URL}/${functionName}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.json();
    }
};