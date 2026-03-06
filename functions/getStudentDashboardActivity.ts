import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

async function requireSession(req) {
    const JWT_SECRET = Deno.env.get("JWT_SECRET");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.substring(7);
    try {
        const secret = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jose.jwtVerify(token, secret);
        return payload;
    } catch {
        return null;
    }
}

// Canonical course-level map — covers all known course IDs
const COURSE_LEVEL_MAP = {
    '422595': 'PK',
    '422618': 'K',
    '422620': 'L1',
    '496294': 'L2',
    '496295': 'L3',
    '496297': 'L4',
    '496298': 'L5',
};

function inferLevel(courseId, existingLevel) {
    if (existingLevel) return existingLevel; // already tagged (new webhooks)
    if (courseId && COURSE_LEVEL_MAP[String(courseId)]) return COURSE_LEVEL_MAP[String(courseId)];
    return null;
}

function normalizeEventType(eventType) {
    const aliasMap = {
        'quiz.attempted': 'quiz_attempted',
        'lesson.completed': 'lesson_completed',
        'user.signin': 'user_signin',
        'user.signup': 'user_signup',
        'enrollment.created': 'enrollment_created'
    };
    return aliasMap[eventType] || eventType;
}

Deno.serve(async (req) => {
    const session = await requireSession(req);
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        const { limit = 5000, studentEmails: providedEmails } = body;

        const teacherEmail = session.email?.toLowerCase().trim();
        console.log(`[DASHBOARD ACTIVITY] Teacher: ${teacherEmail}`);

        const base44 = createClientFromRequest(req);

        // Resolve roster: use provided list OR pull from StudentAccessCode + ArchivedStudent
        let studentEmails;
        if (Array.isArray(providedEmails) && providedEmails.length > 0) {
            studentEmails = providedEmails.map(e => e.toLowerCase().trim());
        } else {
            const [accessCodes, archivedStudents] = await Promise.all([
                base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
                base44.asServiceRole.entities.ArchivedStudent.filter({ teacherEmail }),
            ]);
            const archivedSet = new Set(
                (archivedStudents || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
            );
            studentEmails = (accessCodes || [])
                .map(s => s.studentEmail?.toLowerCase().trim())
                .filter(e => e && e.endsWith('@modalmath.com') && !archivedSet.has(e));
        }

        console.log(`[DASHBOARD ACTIVITY] Roster size: ${studentEmails.length}`, studentEmails);

        // Fetch all activity events (most recent first) — no teacher/group filter at DB level
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-occurredAt', limit);
        console.log(`[DASHBOARD ACTIVITY] Total events fetched: ${allEvents.length}`);

        const studentEmailSet = new Set(studentEmails);

        const filtered = allEvents
            .filter(e => {
                const eventEmail = (e.studentEmail || '').toLowerCase().trim();
                const matches = studentEmailSet.has(eventEmail);
                if (eventEmail === 'azizae414@modalmath.com') {
                    console.log(`[DASHBOARD ACTIVITY] Aziza event: ${e.eventType}, courseId=${e.courseId}, level=${e.level}, matches=${matches}`);
                }
                return matches;
            })
            .map(e => {
                const normalizedEventType = normalizeEventType(e.eventType);

                // Apply COURSE_LEVEL_MAP retroactively for historical events missing a level tag
                const resolvedLevel = inferLevel(e.courseId, e.level);

                // Resolve grade with robust fallbacks
                let displayGrade = (typeof e.grade === 'number') ? e.grade : null;

                if (normalizedEventType === 'quiz_attempted' && displayGrade == null) {
                    if (typeof e.scorePercent === 'number') {
                        displayGrade = e.scorePercent;
                    }
                    if (displayGrade == null && e.metadata && typeof e.metadata.scorePercent === 'number') {
                        displayGrade = e.metadata.scorePercent;
                    }
                    if (displayGrade == null && e.rawPayload) {
                        try {
                            const rawData = JSON.parse(e.rawPayload);
                            const maybePayload = rawData?.payload ? rawData.payload : rawData;
                            const payloadGrade = maybePayload?.grade;
                            if (typeof payloadGrade === 'number') {
                                displayGrade = payloadGrade <= 1 ? payloadGrade * 100 : payloadGrade;
                            }
                        } catch {}
                    }
                }

                return {
                    ...e,
                    eventType: normalizedEventType,
                    grade: displayGrade,
                    level: resolvedLevel,
                };
            })
            .slice(0, limit);

        console.log(`[DASHBOARD ACTIVITY] Returning ${filtered.length} filtered events`);
        const azizaEvents = filtered.filter(e => (e.studentEmail || '').toLowerCase().trim() === 'azizae414@modalmath.com');
        console.log(`[DASHBOARD ACTIVITY] Aziza events in result: ${azizaEvents.length}`);

        return Response.json({ studentEmails, events: filtered }, { status: 200 });
    } catch (error) {
        console.error('[DASHBOARD ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});