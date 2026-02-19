import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { SignJWT } from 'npm:jose@5.9.6';

const JWT_SECRET = Deno.env.get('JWT_SECRET');
const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');

async function getThinkificUserByEmail(email) {
    const url = `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.items && data.items.length > 0) ? data.items[0] : null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentEmail } = await req.json();

        const normalizedEmail = studentEmail.trim().toLowerCase();

        if (!normalizedEmail || !normalizedEmail.includes('@')) {
            return Response.json({ error: 'Valid student email is required' }, { status: 400 });
        }

        // Verify student exists in Thinkific
        const thinkificUser = await getThinkificUserByEmail(normalizedEmail);
        if (!thinkificUser) {
            return Response.json({ error: 'Student not found. Please check your email address.' }, { status: 401 });
        }

        // Ensure StudentAccessCode record exists (create if missing)
        const existing = await base44.asServiceRole.entities.StudentAccessCode.filter({
            studentEmail: normalizedEmail
        });

        if (!existing || existing.length === 0) {
            await base44.asServiceRole.entities.StudentAccessCode.create({
                studentEmail: normalizedEmail,
                createdAt: new Date().toISOString(),
                createdByTeacherEmail: 'system@modalmath.com'
            });
        }

        // Generate JWT (7 days)
        const secret = new TextEncoder().encode(JWT_SECRET);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const token = await new SignJWT({
            email: normalizedEmail,
            type: 'student'
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('7d')
            .sign(secret);

        // Create session record
        await base44.asServiceRole.entities.StudentPortalSession.create({
            studentEmail: normalizedEmail,
            sessionToken: token,
            expiresAt: expiresAt.toISOString(),
            createdAt: new Date().toISOString()
        });

        return Response.json({
            success: true,
            token,
            studentEmail: normalizedEmail
        });

    } catch (error) {
        console.error('Student login error:', error);
        return Response.json({ error: 'Login failed' }, { status: 500 });
    }
});