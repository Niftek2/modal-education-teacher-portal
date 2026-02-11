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
    
    // Check if user has an active enrollment in the "Your Classroom" course
    const hasActive = data.items?.some(enrollment => {
        return String(enrollment.course_id) === String(CLASSROOM_PRODUCT_ID) && 
               enrollment.activated_at && 
               !enrollment.expired;
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

        // Verify user has Classroom bundle access
        const hasAccess = await verifyClassroomBundle(user.id);
        if (!hasAccess) {
            return Response.json({ error: 'No active Classroom bundle enrollment found' }, { status: 403 });
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

        // Construct magic link - use the verify page
        const magicLink = `${req.headers.get('origin')}/Verify?verify=${token}`;

        // Send email via Gmail
        const accessToken = await base44.asServiceRole.connectors.getAccessToken('gmail');
        
        const emailContent = [
            `To: ${email}`,
            'From: Modal Math <contact@modalmath.com>',
            'Subject: Your Teacher Portal Login Link',
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            '<h2>Welcome to Modal Math Teacher Portal</h2>',
            '<p>Click the link below to access your dashboard:</p>',
            `<p><a href="${magicLink}" style="background: #4B2865; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Login to Portal</a></p>`,
            '<p>This link expires in 15 minutes.</p>',
            '<p>If you didn\'t request this, please ignore this email.</p>'
        ].join('\r\n');
        
        const encoder = new TextEncoder();
        const data = encoder.encode(emailContent);
        const base64 = btoa(String.fromCharCode(...data))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        
        const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: base64 })
        });
        
        if (!gmailResponse.ok) {
            const error = await gmailResponse.text();
            throw new Error(`Gmail API error: ${error}`);
        }

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