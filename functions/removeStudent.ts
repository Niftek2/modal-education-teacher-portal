import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(req) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('Unauthorized');
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

async function findGroupMembership(userId, groupId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}&query[group_id]=${groupId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error('Failed to find membership');
    }

    const data = await response.json();
    return data.items?.[0];
}

async function removeGroupMembership(membershipId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships/${membershipId}`, {
        method: 'DELETE',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    return response.ok;
}

Deno.serve(async (req) => {
    try {
        await verifySession(req);
        const { studentId, groupId } = await req.json();

        if (!studentId || !groupId) {
            return Response.json({ error: 'Student ID and Group ID required' }, { status: 400 });
        }

        // Find membership
        const membership = await findGroupMembership(studentId, groupId);
        
        if (!membership) {
            return Response.json({ error: 'Membership not found' }, { status: 404 });
        }

        // Remove membership
        const success = await removeGroupMembership(membership.id);

        if (!success) {
            return Response.json({ error: 'Failed to remove student' }, { status: 500 });
        }

        return Response.json({ success: true });

    } catch (error) {
        console.error('Remove student error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});