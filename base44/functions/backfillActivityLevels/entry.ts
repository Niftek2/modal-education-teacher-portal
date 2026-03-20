import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const COURSE_LEVEL_MAP = {
    '422595': 'PK', '422618': 'K', '422620': 'L1',
    '496294': 'L2', '496295': 'L3', '496297': 'L4', '496298': 'L5',
};

const THINKIFIC_HEADERS = {
    'Authorization': `Bearer ${Deno.env.get('THINKIFIC_API_ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
};

// Fetch lesson → course mapping from Thinkific API
async function fetchLessonCourse(lessonId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/lessons/${lessonId}`,
        { headers: THINKIFIC_HEADERS }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.course_id ? String(data.course_id) : null;
}

Deno.serve(async (req) => {
    // Simple auth: must pass the upload key as a header
    const uploadKey = req.headers.get('X-Upload-Key') || (await req.json().catch(() => ({}))).uploadKey;
    if (uploadKey !== Deno.env.get('HISTORICAL_DATA_UPLOAD_KEY')) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);

    let page = 0;
    const pageSize = 500;
    let totalFixed = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    // Build LessonCourseMap cache from DB upfront
    const allLessonMaps = await base44.asServiceRole.entities.LessonCourseMap.list('-created_date', 5000);
    const lessonCourseCache = {};
    for (const m of allLessonMaps) {
        if (m.lessonId) lessonCourseCache[String(m.lessonId)] = String(m.courseId);
    }
    console.log(`[BACKFILL] Loaded ${allLessonMaps.length} LessonCourseMap entries`);

    // Process all quiz_attempted events missing a level
    while (true) {
        const events = await base44.asServiceRole.entities.ActivityEvent.filter(
            { eventType: 'quiz_attempted' },
            '-occurredAt',
            pageSize
        ).catch(() => []);

        if (events.length === 0) break;

        const needsLevel = events.filter(e => !e.level);
        console.log(`[BACKFILL] Page ${page}: ${events.length} quiz events, ${needsLevel.length} missing level`);

        if (needsLevel.length === 0) {
            page++;
            if (events.length < pageSize) break;
            continue;
        }

        for (const event of needsLevel) {
            // 1. Try courseId directly
            let courseId = event.courseId ? String(event.courseId) : null;
            let level = courseId ? COURSE_LEVEL_MAP[courseId] : null;

            // 2. Try LessonCourseMap cache
            if (!level && event.lessonId) {
                const mappedCourseId = lessonCourseCache[String(event.lessonId)];
                if (mappedCourseId) {
                    courseId = mappedCourseId;
                    level = COURSE_LEVEL_MAP[courseId];
                }
            }

            // 3. Try Thinkific API as last resort
            if (!level && event.lessonId) {
                const apiCourseId = await fetchLessonCourse(event.lessonId).catch(() => null);
                if (apiCourseId) {
                    courseId = apiCourseId;
                    level = COURSE_LEVEL_MAP[courseId];
                    // Upsert into LessonCourseMap for future use
                    if (level && !lessonCourseCache[String(event.lessonId)]) {
                        lessonCourseCache[String(event.lessonId)] = courseId;
                        base44.asServiceRole.entities.LessonCourseMap.create({
                            lessonId: String(event.lessonId),
                            courseId,
                            courseName: level,
                            lastSeenAt: new Date().toISOString()
                        }).catch(() => {});
                    }
                }
            }

            if (!level) {
                totalSkipped++;
                continue;
            }

            // Update the event
            await base44.asServiceRole.entities.ActivityEvent.update(event.id, {
                level,
                courseId: courseId ? Number(courseId) : event.courseId
            }).catch((e) => {
                console.warn(`[BACKFILL] Failed to update event ${event.id}: ${e.message}`);
                totalFailed++;
            });
            totalFixed++;
        }

        page++;
        if (events.length < pageSize) break;
    }

    console.log(`[BACKFILL] Done. Fixed: ${totalFixed}, Skipped (no mapping found): ${totalSkipped}, Failed: ${totalFailed}`);
    return Response.json({ success: true, totalFixed, totalSkipped, totalFailed });
});