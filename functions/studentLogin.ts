import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { SignJWT } from 'npm:jose@5.9.6';

const JWT_SECRET = Deno.env.get('JWT_SECRET');

async function hashCode(code) {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { studentEmail, accessCode } = await req.json();

        const normalizedEmail = studentEmail.trim().toLowerCase();

        // Get student access code record
        const accessCodes = await base44.asServiceRole.entities.StudentAccessCode.filter({ 
            studentEmail: normalizedEmail 
        });

        if (!accessCodes || accessCodes.length === 0) {
            return Response.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        const record = accessCodes[0];
        const hashedInput = await hashCode(accessCode);

        if (hashedInput !== record.codeHash) {
            return Response.json({ error: 'Invalid credentials' }, { status: 401 });
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