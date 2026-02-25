import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { requireSession } from './lib/auth.js';

Deno.serve(async (req) => {
    const t0 = Date.now();
    let t1, t2, t3, t4;

    let session;
    try {
        session = await requireSession(req);
    } catch (e) {
        return Response.json({ error: e.message }, { status: 401 });
    }

    if (!session) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    try {
        const base44 = createClientFromRequest(req);
        const teacherEmail = session.email?.toLowerCase().trim();
        
        const ASSIGNMENTS_COURSE_ID = Deno.env.get("ASSIGNMENTS_COURSE_ID") || '3359727';
        const COURSE_LEVEL_MAP = {
            [Deno.env.get("PK_COURSE_ID")]: 'PK',
            [Deno.env.get("K_COURSE_ID")]: 'K',
            [Deno.env.get("L1_COURSE_ID")]: 'L1',
            [Deno.env.get("L2_COURSE_ID")]: 'L2',
            [Deno.env.get("L3_COURSE_ID")]: 'L3',
            [Deno.env.get("L4_COURSE_ID")]: 'L4',
            [Deno.env.get("L5_COURSE_ID")]: 'L5',
            [ASSIGNMENTS_COURSE_ID]: 'Assignments',
        };
        t1 = Date.now();

        const isTeacher = session.isTeacher === true || session.role === 'teacher';
        if (!isTeacher) {
            return Response.json({ error: "Forbidden: Not authorized as a teacher." }, { status: 403 });
        }

        const [studentCodes, archivedStudents, assignments, catalogItems] = await Promise.all([
            base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
            base44.asServiceRole.entities.ArchivedStudent.filter({}),
            base44.asServiceRole.entities.StudentAssignment.filter({ teacherEmail }),
            base44.asServiceRole.entities.AssignmentCatalog.list('title', 2000)
        ]);
        t2 = Date.now();

        const archivedEmailSet = new Set(
            (archivedStudents || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean)
        );

        const allEmails = (studentCodes || [])
            .map(s => s.studentEmail?.toLowerCase().trim())
            .filter(email => email && email.endsWith('@modalmath.com'));

        const activeEmails = allEmails.filter(e => !archivedEmailSet.has(e)).sort();
        const archivedEmails = allEmails.filter(e => archivedEmailSet.has(e)).sort();

        const roster = [
            ...activeEmails.map(email => ({ email, isArchived: false })),
            ...archivedEmails.map(email => ({ email, isArchived: true }))
        ];

        const activeCatalog = (catalogItems || []).filter(item => item.isActive !== false);
        t3 = Date.now();

        // Fetch quiz attempt events for all students of this teacher to attach scores
        const studentEmailList = roster.map(r => r.email);
        let quizEvents = [];
        try {
            quizEvents = await base44.asServiceRole.entities.ActivityEvent.filter({ eventType: 'quiz.attempted' });
        } catch (_e) {
            quizEvents = [];
        }

        // Build a map: "studentEmail:lessonId" -> latest attempt event
        const latestAttemptMap = new Map();
        for (const ev of quizEvents) {
            const email = String(ev.studentEmail || '').toLowerCase().trim();
            const lid = ev.lessonId != null ? String(ev.lessonId) : null;
            if (!email || !lid) continue;
            const key = `${email}:${lid}`;
            const existing = latestAttemptMap.get(key);
            if (!existing || new Date(ev.occurredAt) > new Date(existing.occurredAt)) {
                latestAttemptMap.set(key, ev);
            }
        }

        function computeScore(ev) {
            if (!ev) return { scorePercent: null, correctCount: null, totalQuestions: null, courseName: null, level: null };

            // Step 2: Use payload.grade as the primary score source
            const grade = ev.grade;
            let scorePercent = null;
            if (typeof grade === 'number') {
                if (grade >= 0 && grade <= 1) scorePercent = Math.round(grade * 100);
                else if (grade > 1 && grade <= 100) scorePercent = Math.round(grade);
            }

            // Step 3: Attach correct/total only if both are strictly numbers
            const cc = ev.correctCount;
            const ic = ev.incorrectCount;
            const correctCount = (typeof cc === 'number') ? cc : null;
            const totalQuestions = (typeof cc === 'number' && typeof ic === 'number') ? cc + ic : null;

            // Determine courseName/level for activity display
            let courseName = ev.courseName || null;
            let level = COURSE_LEVEL_MAP[String(ev.courseId)] || null;

            return { scorePercent, correctCount, totalQuestions, courseName, level };
        }

        const sortedAssignments = (assignments || [])
            .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
            .map(a => {
                // Primary: use score persisted directly on the assignment
                if (typeof a.score === 'number') {
                    const md = a.metadata || {};
                    return {
                        ...a,
                        scorePercent: a.score,
                        correctCount: typeof md.correctCount === 'number' ? md.correctCount : null,
                        totalQuestions: typeof md.totalQuestions === 'number' ? md.totalQuestions : null,
                        courseName: a.courseName || COURSE_LEVEL_MAP[String(a.courseId)] || null,
                        level: a.level || COURSE_LEVEL_MAP[String(a.courseId)] || null,
                    };
                }
                // Fallback: derive from ActivityEvent
                const email = String(a.studentEmail || '').toLowerCase().trim();
                const lid = a.lessonId != null ? String(a.lessonId) : null;
                const key = lid ? `${email}:${lid}` : null;
                const ev = key ? latestAttemptMap.get(key) : null;
                const scoreDetails = computeScore(ev);
                return { 
                    ...a, 
                    ...scoreDetails,
                    courseName: scoreDetails.courseName || a.courseName || COURSE_LEVEL_MAP[String(a.courseId)] || null,
                    level: scoreDetails.level || a.level || COURSE_LEVEL_MAP[String(a.courseId)] || null,
                };
            });
        const studentsCount = roster?.length || 0;
        const catalogCount = activeCatalog?.length || 0;
        const assignmentsCount = sortedAssignments?.length || 0;
        const archivedStudentsCount = archivedStudents?.length || 0;
        t4 = Date.now();

        return Response.json({
            success: true,
            teacherEmail,
            students: roster,
            catalog: activeCatalog,
            assignments: sortedAssignments,
            debug: {
                ms: { t0, t1, t2, t3, t4, total: t4 - t0 },
                stepMs: { auth: t1 - t0, fetch: t2 - t1, rosterBuild: t3 - t2, finalize: t4 - t3 },
                counts: { studentsCount, catalogCount, assignmentsCount, archivedStudentsCount },
                teacherEmail
            }
        });

    } catch (error) {
        console.error('Get teacher assignments error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});