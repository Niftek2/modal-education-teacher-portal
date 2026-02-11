import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const CLASSROOM_PRODUCT_ID = Deno.env.get("CLASSROOM_PRODUCT_ID");
const MAGIC_LINK_SECRET = Deno.env.get("MAGIC_LINK_SECRET");

async function findThinkificUser(email) {
    console.log('Looking up user:', email);
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`, {
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Thinkific API error:', response.status, errorText);
        throw new Error(`Thinkific API returned ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Found user:', data.items?.[0] ? `ID ${data.items[0].id}` : 'none');
    return data.items?.[0];
}

async function verifyClassroomBundle(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[product_id]=${CLASSROOM_PRODUCT_ID}`, {
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Enrollment check failed:', response.status, errorText);
        throw new Error(`Failed to check enrollment: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Enrollment data:', JSON.stringify(data));
    console.log('Checking CLASSROOM_PRODUCT_ID:', CLASSROOM_PRODUCT_ID);
    console.log('User ID:', userId);
    
    if (!data.items || data.items.length === 0) {
        console.log('No enrollments found for user');
        return false;
    }
    
    const hasActive = data.items.some(enrollment => {
        console.log('Enrollment:', JSON.stringify(enrollment));
        return enrollment.activated_at && !enrollment.expired_at;
    });
    
    console.log('Has active enrollment:', hasActive);
    return hasActive;
}

Deno.serve(async (req) => {
    try {
        console.log('=== Auth Request Started ===');
        const base44 = createClientFromRequest(req);
        const { email } = await req.json();
        console.log('Email received:', email);

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

        // Verify Classroom bundle enrollment
        const hasAccess = await verifyClassroomBundle(user.id);
        if (!hasAccess) {
            return Response.json({ error: 'Active Classroom bundle enrollment required to access portal' }, { status: 403 });
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
        console.error('Error stack:', error.stack);
        return Response.json({ 
            error: error.message,
            details: error.stack 
        }, { status: 500 });
    }
});