import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

Deno.serve(async (req) => {
    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return Response.json({ error: "No token provided" }, { status: 401 });
        }

        const oldToken = authHeader.substring(7);
        const secret = new TextEncoder().encode(JWT_SECRET);

        // Verify the old token — allow it even if expired (within 7-day grace window)
        let payload;
        try {
            const result = await jose.jwtVerify(oldToken, secret);
            payload = result.payload;
        } catch (err) {
            // If token is expired but was valid, try decoding without verification
            // to extract claims and issue a fresh token (grace-period refresh)
            if (err.code === 'ERR_JWT_EXPIRED') {
                const decoded = jose.decodeJwt(oldToken);
                // Only grant refresh if token expired within 7 days
                const expiredAt = decoded.exp * 1000;
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                if (Date.now() - expiredAt > sevenDaysMs) {
                    return Response.json({ error: "Token too old to refresh" }, { status: 401 });
                }
                payload = decoded;
            } else {
                return Response.json({ error: "Invalid token" }, { status: 401 });
            }
        }

        if (!payload.email || !payload.userId) {
            return Response.json({ error: "Invalid token payload" }, { status: 401 });
        }

        // Issue a fresh 45-minute session token
        const newToken = await new jose.SignJWT({
            email: payload.email,
            userId: payload.userId,
            type: 'session'
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('45m')
            .setIssuedAt()
            .sign(secret);

        return Response.json({
            success: true,
            sessionToken: newToken,
            user: { email: payload.email, userId: payload.userId }
        });

    } catch (error) {
        console.error('Refresh session error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});