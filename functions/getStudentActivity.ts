import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(req) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('Unauthorized');
    }

    const token = authHeader.substring(7);
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

async function getCourseProgress(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/course_progresses?query[user_id]=${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return data.items || [];
}

Deno.serve(async (req) => {
    try {
        await verifySession(req);
        const { studentId } = await req.json();

        if (!studentId) {
            return Response.json({ error: 'Student ID required' }, { status: 400 });
        }

        const progress = await getCourseProgress(studentId);

        const activity = progress.map(p => ({
            courseId: p.course_id,
            courseName: p.course_name || 'Course',
            percentage: p.percentage_completed || 0,
            completedChapters: p.completed_chapters || 0,
            totalChapters: p.total_chapters || 0,
            lastActivity: p.updated_at,
            startedAt: p.started_at
        }));

        return Response.json({ activity });

    } catch (error) {
        console.error('Get student activity error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});