import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");

async function createThinkificGroup(teacherName, teacherEmail) {
    const groupName = `${teacherName}'s Classroom`;
    
    const response = await fetch('https://api.thinkific.com/api/public/v1/groups', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: groupName
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create group');
    }

    return await response.json();
}

async function addTeacherToGroup(userId, groupId) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/group_memberships', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: userId,
            group_id: groupId
        })
    });

    if (!response.ok) {
        throw new Error('Failed to add teacher to group');
    }

    return await response.json();
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const evt = await req.json();
        
        const webhookId = evt.id || crypto.randomUUID();
        const resource = String(evt.resource || 'unknown');
        const action = String(evt.action || 'unknown');
        const eventType = `${resource}.${action}`;
        
        console.log(`[ENROLLMENT WEBHOOK] Event: ${eventType}, ID: ${webhookId}`);

        // Only process enrollment.created events
        if (eventType !== 'enrollment.created') {
            console.log(`[ENROLLMENT WEBHOOK] Ignoring event type: ${eventType}`);
            return Response.json({ success: true, ignored: true });
        }

        const payload = evt.payload;
        const productId = String(payload?.product_id);
        const userId = payload?.user?.id;
        const userEmail = payload?.user?.email?.trim().toLowerCase();
        const userName = `${payload?.user?.first_name || ''} ${payload?.user?.last_name || ''}`.trim();

        // Only process enrollments in "Your Classroom" product
        if (productId !== CLASSROOM_PRODUCT_ID) {
            console.log(`[ENROLLMENT WEBHOOK] Not classroom product. Got ${productId}, expected ${CLASSROOM_PRODUCT_ID}`);
            return Response.json({ success: true, notClassroom: true });
        }

        if (!userId || !userEmail) {
            console.error('[ENROLLMENT WEBHOOK] Missing user ID or email');
            return Response.json({ error: 'Missing user data' }, { status: 400 });
        }

        console.log(`[ENROLLMENT WEBHOOK] Teacher ${userEmail} (ID: ${userId}) enrolled in Classroom`);

        // Check if teacher already has a group
        const existing = await base44.asServiceRole.entities.TeacherGroup.filter({
            teacherThinkificUserId: String(userId)
        });

        if (existing.length > 0) {
            console.log(`[ENROLLMENT WEBHOOK] Teacher already has group: ${existing[0].thinkificGroupId}`);
            return Response.json({ success: true, alreadyExists: true, groupId: existing[0].thinkificGroupId });
        }

        // Create Thinkific group for the teacher
        console.log(`[ENROLLMENT WEBHOOK] Creating group for teacher: ${userName}`);
        const group = await createThinkificGroup(userName, userEmail);
        
        // Add teacher to their own group
        await addTeacherToGroup(userId, group.id);

        // Store mapping in database
        await base44.asServiceRole.entities.TeacherGroup.create({
            teacherThinkificUserId: String(userId),
            teacherEmail: userEmail,
            thinkificGroupId: String(group.id),
            thinkificGroupName: group.name
        });

        console.log(`[ENROLLMENT WEBHOOK] ✓ Created group ${group.id} for teacher ${userEmail}`);

        return Response.json({
            success: true,
            groupId: group.id,
            groupName: group.name,
            teacherId: userId
        });

    } catch (error) {
        console.error('[ENROLLMENT WEBHOOK] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});