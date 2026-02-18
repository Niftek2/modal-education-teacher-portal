import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");

export async function requireSession(req) {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.substring(7);

    try {
        const secret = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret);
        // Accept teacher session tokens (type: 'session') and student tokens (type: 'student')
        if (!payload.email) return null;
        return payload;
    } catch {
        return null;
    }
}

export async function requireTeacherSession(req) {
    const session = await requireSession(req);
    if (!session) return null;
    // Teacher sessions have type 'session'; reject student tokens
    if (session.type === 'student') return null;
    return session;
}