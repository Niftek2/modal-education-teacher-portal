import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jwtVerify } from 'npm:jose@5.9.6';

const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');
const JWT_SECRET = Deno.env.get('JWT_SECRET');

const COURSE_IDS = {
    PK: Deno.env.get('COURSE_ID_PK'),
    K: Deno.env.get('COURSE_ID_K'),
    L1: Deno.env.get('COURSE_ID_L1'),
    L2: Deno.env.get('COURSE_ID_L2'),
    L3: Deno.env.get('COURSE_ID_L3'),
    L4: Deno.env.get('COURSE_ID_L4'),
    L5: Deno.env.get('COURSE_ID_L5')
};

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return payload;
}

async function fetchThinkificLessons(courseId) {
    const response = await fetch(
        `https://api.thinkific.com/api/public/v1/courses/${courseId}/chapters`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch chapters for course ${courseId}`);
    }

    const data = await response.json();
    const lessons = [];

    for (const chapter of data.items || []) {
        if (chapter.contents && Array.isArray(chapter.contents)) {
            for (const content of chapter.contents) {
                if (content.contentable_type === 'Lesson') {
                    lessons.push({
                        lessonId: String(content.contentable_id),
                        title: content.name,
                        courseId: String(courseId)
                    });
                }
            }
        }
    }

    return lessons;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { sessionToken } = await req.json();

        // Verify session
        const session = await verifySession(sessionToken);
        if (!session.email) {
            return Response.json({ error: 'Authentication required' }, { status: 403 });
        }

        let totalLessons = 0;
        let totalCreated = 0;
        let totalUpdated = 0;

        for (const [level, courseId] of Object.entries(COURSE_IDS)) {
            if (!courseId) continue;

            const lessons = await fetchThinkificLessons(courseId);
            totalLessons += lessons.length;

            for (const lesson of lessons) {
                const thinkificUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/courses/take/${courseId}/lessons/${lesson.lessonId}`;
                
                // Check if already exists
                const existing = await base44.asServiceRole.entities.AssignmentCatalog.filter({
                    lessonId: lesson.lessonId
                });

                if (existing && existing.length > 0) {
                    // Update existing
                    await base44.asServiceRole.entities.AssignmentCatalog.update(existing[0].id, {
                        title: lesson.title,
                        level: level,
                        type: 'lesson',
                        courseId: lesson.courseId,
                        lessonId: lesson.lessonId,
                        thinkificUrl: thinkificUrl,
                        isActive: true
                    });
                    totalUpdated++;
                } else {
                    // Create new
                    await base44.asServiceRole.entities.AssignmentCatalog.create({
                        title: lesson.title,
                        level: level,
                        type: 'lesson',
                        courseId: lesson.courseId,
                        lessonId: lesson.lessonId,
                        thinkificUrl: thinkificUrl,
                        isActive: true
                    });
                    totalCreated++;
                }
            }
        }

        return Response.json({
            success: true,
            totalLessons,
            created: totalCreated,
            updated: totalUpdated,
            message: `Synced ${totalLessons} lessons from Thinkific (${totalCreated} created, ${totalUpdated} updated)`
        });

    } catch (error) {
        console.error('Sync lessons error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});