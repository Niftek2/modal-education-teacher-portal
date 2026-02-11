import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");
const MAGIC_LINK_SECRET = Deno.env.get("MAGIC_LINK_SECRET");

async function findThinkificUser(email) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Thinkific API error:', response.status, errorText);
        throw new Error(`Thinkific API returned ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    return data.items?.[0];
}

async function verifyUserInGroup(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/group_memberships?query[user_id]=${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        return false;
    }
    
    const data = await response.json();
    return data.items && data.items.length > 0;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { email } = await req.json();

        if (!email || !email.includes('@')) {
            return Response.json({ error: 'Valid email required' }, { status: 400 });
        }

        // Verify email is NOT a student email
        if (email.toLowerCase().endsWith('@modalmath.com')) {
            return Response.json({ error: 'Student accounts cannot access the teacher portal' }, { status: 403 });
        }

        // Find user in Thinkific
        const user = await findThinkificUser(email);
        if (!user) {
            return Response.json({ error: 'No account found with this email' }, { status: 404 });
        }

        // Verify user is in a group
        const inGroup = await verifyUserInGroup(user.id);
        if (!inGroup) {
            return Response.json({ error: 'You must be assigned to a group to access the portal' }, { status: 403 });
        }

        // Generate magic link token
        const secret = new TextEncoder().encode(MAGIC_LINK_SECRET);
        const token = await new jose.SignJWT({ 
            email: user.email,
            userId: user.id,
            type: 'magic-link'
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('15m')
            .setIssuedAt()
            .sign(secret);

        // Get base URL from request
        const origin = req.headers.get('origin') || req.headers.get('referer')?.split('?')[0] || 'https://app.base44.com';
        const magicLink = `${origin}?verify=${token}`;

        // Send email via Base44
        await base44.integrations.Core.SendEmail({
            to: email,
            from_name: 'Modal Math',
            subject: 'Your Teacher Portal Login Link',
            body: `
                <h2>Welcome to Modal Math Teacher Portal</h2>
                <p>Click the link below to access your dashboard:</p>
                <p><a href="${magicLink}" style="background: #4B2865; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Login to Portal</a></p>
                <p>This link expires in 15 minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        });

        return Response.json({ 
            success: true,
            message: 'Magic link sent to your email'
        });

    } catch (error) {
        console.error('Auth request error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});