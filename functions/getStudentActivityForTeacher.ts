// 🔒 PRODUCTION LOCKED – Migrated to getStudentDashboardActivity
// This function is maintained for backward compatibility only
// All new code should use getStudentDashboardActivity

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const base44 = createClientFromRequest(req);
        
        // Delegate to the new canonical function
        const response = await base44.functions.invoke('getStudentDashboardActivity', body);
        
        return Response.json(response.data, { status: 200 });
    } catch (error) {
        console.error('[ACTIVITY COMPAT] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});