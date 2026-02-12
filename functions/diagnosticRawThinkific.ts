import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

Deno.serve(async (req) => {
    try {
        const { studentEmail } = await req.json();

        if (!studentEmail) {
            return Response.json({ error: 'studentEmail required' }, { status: 400 });
        }

        console.log(`[DIAGNOSTIC] Looking up student: ${studentEmail}`);

        // Step 1: Find user by email
        const userUrl = `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(studentEmail)}`;
        console.log(`[DIAGNOSTIC] Fetching: ${userUrl}`);

        const userResponse = await fetch(userUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });

        const userStatus = userResponse.status;
        const userData = await userResponse.json();

        console.log(`[DIAGNOSTIC] User lookup status: ${userStatus}`);
        console.log(`[DIAGNOSTIC] User data:`, JSON.stringify(userData, null, 2));

        if (!userData.items || userData.items.length === 0) {
            return Response.json({
                error: 'User not found',
                studentEmail,
                userLookupStatus: userStatus,
                userLookupResponse: userData
            }, { status: 404 });
        }

        const user = userData.items[0];
        const userId = user.id;

        console.log(`[DIAGNOSTIC] Found user ID: ${userId}`);

        // Step 2: Get course_progresses - EXACT CALL USER REQUESTED
        const progressUrl = `https://api.thinkific.com/api/public/v1/course_progresses?query[user_id]=${userId}`;
        console.log(`[DIAGNOSTIC] Fetching: ${progressUrl}`);

        const progressResponse = await fetch(progressUrl, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });

        const progressStatus = progressResponse.status;
        const progressHeaders = {};
        progressResponse.headers.forEach((value, key) => {
            progressHeaders[key] = value;
        });

        const progressBody = await progressResponse.json();

        console.log(`[DIAGNOSTIC] Progress status: ${progressStatus}`);
        console.log(`[DIAGNOSTIC] Progress response:`, JSON.stringify(progressBody, null, 2));

        // Return FULL raw response
        return Response.json({
            studentEmail,
            thinkificUserId: userId,
            userName: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
            
            courseProgressesEndpoint: progressUrl,
            httpStatus: progressStatus,
            responseHeaders: progressHeaders,
            fullRawJsonBody: progressBody,
            
            pagination: {
                totalItems: progressBody.items?.length || 0,
                meta: progressBody.meta || null
            }
        }, { status: 200 });

    } catch (error) {
        console.error('[DIAGNOSTIC] Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});