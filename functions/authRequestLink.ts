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
    // Get ALL enrollments for the user
    const url = `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}`;
    
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to check enrollment: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Check if user has an active enrollment in the Classroom bundle
    const hasActive = data.items?.some(enrollment => {
        return String(enrollment.product_id) === String(CLASSROOM_PRODUCT_ID) && 
               enrollment.activated_at && 
               !enrollment.expired_at;
    });
    
    return hasActive || false;
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

        // DEBUG: Get all enrollments
        const enrollResponse = await fetch(`https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${user.id}`, {
            headers: {
                'Authorization': `Bearer ${THINKIFIC_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const enrollData = await enrollResponse.json();
        
        return Response.json({
            debug: true,
            userId: user.id,
            userEmail: user.email,
            classroomProductId: CLASSROOM_PRODUCT_ID,
            classroomProductIdType: typeof CLASSROOM_PRODUCT_ID,
            allEnrollments: enrollData.items?.map(e => ({
                product_id: e.product_id,
                product_id_type: typeof e.product_id,
                product_name: e.product_name,
                activated_at: e.activated_at,
                expired_at: e.expired_at
            })) || []
        });

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