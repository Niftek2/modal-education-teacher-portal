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

        // Check if user is enrolled in "Your Classroom" course (teacher access)
        let isTeacher = false;
        try {
            const enrollUrl = `https://${Deno.env.get("THINKIFIC_SUBDOMAIN")}.thinkific.com/api/public/v1/enrollments?query[user_id]=${payload.userId}&query[course_id]=552235`;
            const enrollRes = await fetch(enrollUrl, {
                headers: {
                    'Authorization': `Bearer ${Deno.env.get("THINKIFIC_API_ACCESS_TOKEN")}`,
                    'Content-Type': 'application/json'
                }
            });
            if (enrollRes.ok) {
                const enrollData = await enrollRes.json();
                isTeacher = (enrollData.items || []).length > 0;
            }
        } catch (e) {
            console.warn('Teacher enrollment check failed:', e.message);
        }

        // Create long-lived session JWT (30 days)
        const sessionSecret = new TextEncoder().encode(JWT_SECRET);
        const sessionToken = await new jose.SignJWT({
            email: payload.email,
            userId: payload.userId,
            type: 'session',
            isTeacher,
            role: isTeacher ? 'teacher' : 'student'
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('30d')
            .setIssuedAt()
            .sign(sessionSecret);

        return Response.json({
            success: true,
            sessionToken,
            user: {
                email: payload.email,
                userId: payload.userId,
                isTeacher,
                role: isTeacher ? 'teacher' : 'student'
            }
        });

    } catch (error) {
        console.error('Auth verify error:', error);
        return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
});