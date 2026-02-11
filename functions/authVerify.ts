import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const MAGIC_LINK_SECRET = Deno.env.get("MAGIC_LINK_SECRET");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

Deno.serve(async (req) => {
    try {
        const { token } = await req.json();

        if (!token) {
            return Response.json({ error: 'Token required' }, { status: 400 });
        }

        // Verify magic link token
        const magicSecret = new TextEncoder().encode(MAGIC_LINK_SECRET);
        const { payload } = await jose.jwtVerify(token, magicSecret);

        if (payload.type !== 'magic-link') {
            return Response.json({ error: 'Invalid token type' }, { status: 400 });
        }

        // Create session JWT
        const sessionSecret = new TextEncoder().encode(JWT_SECRET);
        const sessionToken = await new jose.SignJWT({
            email: payload.email,
            userId: payload.userId,
            type: 'session'
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('12h')
            .setIssuedAt()
            .sign(sessionSecret);

        return Response.json({
            success: true,
            sessionToken,
            user: {
                email: payload.email,
                userId: payload.userId
            }
        });

    } catch (error) {
        console.error('Auth verify error:', error);
        return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
});