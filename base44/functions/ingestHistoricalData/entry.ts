import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { parse } from 'npm:csv-parse/sync';

const COURSE_LEVEL_MAP = {
    '422595': 'PK', '422618': 'K', '422620': 'L1',
    '496294': 'L2', '496295': 'L3', '496297': 'L4', '496298': 'L5',
};

function inferLevel(courseId, courseName) {
    if (courseId && COURSE_LEVEL_MAP[String(courseId)]) return COURSE_LEVEL_MAP[String(courseId)];
    if (!courseName) return null;
    if (/\bPK\b/i.test(courseName)) return 'PK';
    if (/\bL5\b/i.test(courseName)) return 'L5';
    if (/\bL4\b/i.test(courseName)) return 'L4';
    if (/\bL3\b/i.test(courseName)) return 'L3';
    if (/\bL2\b/i.test(courseName)) return 'L2';
    if (/\bL1\b/i.test(courseName)) return 'L1';
    if (/\bK\b/i.test(courseName)) return 'K';
    return null;
}

function col(row, ...names) {
    for (const name of names) {
        const key = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase());
        if (key && row[key] !== undefined && row[key] !== '') return row[key];
    }
    return null;
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

async function upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt) {
    if (!userId) return;
    const displayName = `${firstName || ''} ${lastName || ''}`.trim();
    const normalizedEmail = (email || '').toLowerCase().trim();
    const existing = await base44.asServiceRole.entities.StudentProfile.filter({ thinkificUserId: Number(userId) });
    if (existing.length > 0) {
        await base44.asServiceRole.entities.StudentProfile.update(existing[0].id, {
            displayName: displayName || existing[0].displayName,
            email: normalizedEmail || existing[0].email,
            firstName: firstName || existing[0].firstName,
            lastName: lastName || existing[0].lastName,
            lastSeenAt: occurredAt,
        });
    } else {
        await base44.asServiceRole.entities.StudentProfile.create({
            thinkificUserId: Number(userId),
            displayName: displayName || normalizedEmail,
            email: normalizedEmail,
            firstName: firstName || '',
            lastName: lastName || '',
            lastSeenAt: occurredAt,
        });
    }
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    try {
        const body = await req.json();
        const { magicKey, teacherEmail: rawTeacherEmail, csvData } = body;

        // Auth via magic key
        const expectedKey = Deno.env.get('HISTORICAL_DATA_UPLOAD_KEY');
        if (!magicKey || magicKey !== expectedKey) {
            return Response.json({ error: 'Unauthorized: invalid key' }, { status: 401 });
        }

        if (!rawTeacherEmail || !csvData) {
            return Response.json({ error: 'teacherEmail and csvData are required' }, { status: 400 });
        }

        const teacherEmail = rawTeacherEmail.toLowerCase().trim();

        // Parse CSV
        let rows;
        rows = parse(csvData, { columns: true, skip_empty_lines: true, trim: true });

        let created = 0;
        let skipped = 0;
        const errors = [];

        for (const row of rows) {
            try {
                const userId = col(row, 'user_id', 'User ID', 'userId', 'thinkific_user_id');
                const email = (col(row, 'email', 'Email', 'user_email') || '').toLowerCase().trim();
                const firstName = col(row, 'first_name', 'First Name', 'firstName') || '';
                const lastName = col(row, 'last_name', 'Last Name', 'lastName') || '';
                const courseId = col(row, 'course_id', 'Course ID', 'courseId');
                const courseName = col(row, 'course_name', 'Course Name', 'courseName');
                const lessonId = col(row, 'lesson_id', 'Lesson ID', 'lessonId');
                const lessonName = col(row, 'lesson_name', 'Lesson Name', 'lessonName');
                const quizId = col(row, 'quiz_id', 'Quiz ID', 'quizId');
                const quizName = col(row, 'quiz_name', 'Quiz Name', 'quizName');
                const grade = col(row, 'grade', 'Grade', 'percentage', 'score', 'Score');
                const correctCount = col(row, 'correct', 'correct_count', 'Correct', 'Correct Count');
                const incorrectCount = col(row, 'incorrect', 'incorrect_count', 'Incorrect', 'Incorrect Count');
                const attemptNumber = col(row, 'attempt', 'attempt_number', 'Attempt', 'Attempt Number');
                const completedAt = col(row, 'completed_at', 'Completed At', 'completedAt', 'date', 'Date', 'timestamp');

                if (!userId || !email) {
                    errors.push(`Row skipped: missing user_id or email`);
                    skipped++;
                    continue;
                }

                const occurredAt = completedAt ? new Date(completedAt).toISOString() : new Date().toISOString();

                // Determine event type
                const isQuiz = !!(quizId || quizName);
                const eventType = isQuiz ? 'quiz_attempted' : 'lesson_completed';
                const contentName = quizName || lessonName || courseName || 'Unknown';

                // Build dedupeKey
                const hashInput = `${userId}:${eventType}:${courseId || ''}:${quizId || lessonId || ''}:${occurredAt}`;
                const dedupeKey = `csv:${hashString(hashInput)}`;

                // Check dedupe
                const existing = await base44.asServiceRole.entities.ActivityEvent.filter({ dedupeKey });
                if (existing.length > 0) {
                    skipped++;
                    continue;
                }

                // Parse grade
                let gradePercent = null;
                if (grade != null && grade !== '') {
                    const numGrade = parseFloat(grade);
                    if (!isNaN(numGrade)) {
                        gradePercent = (numGrade > 0 && numGrade <= 1) ? Math.round(numGrade * 100) : numGrade;
                    }
                }
                if (gradePercent == null && correctCount != null && incorrectCount != null) {
                    const total = Number(correctCount) + Number(incorrectCount);
                    if (total > 0) gradePercent = Math.round((Number(correctCount) / total) * 100);
                }

                const level = inferLevel(courseId, courseName);

                await upsertStudentProfile(base44, userId, email, firstName, lastName, occurredAt);

                const activity = {
                    thinkificUserId: Number(userId),
                    source: 'csv',
                    eventType,
                    occurredAt,
                    dedupeKey,
                    courseId: courseId ? Number(courseId) : null,
                    courseName: courseName || null,
                    lessonId: lessonId ? Number(lessonId) : null,
                    lessonName: contentName,
                    attemptNumber: attemptNumber ? Number(attemptNumber) : null,
                    grade: gradePercent,
                    correctCount: correctCount ? Number(correctCount) : null,
                    incorrectCount: incorrectCount ? Number(incorrectCount) : null,
                    studentEmail: email,
                    studentDisplayName: `${firstName} ${lastName}`.trim(),
                    rawPayload: JSON.stringify(row),
                };

                await base44.asServiceRole.entities.ActivityEvent.create(activity);

                // Update StudentProfile level if we have one
                if (isQuiz && level) {
                    const profiles = await base44.asServiceRole.entities.StudentProfile.filter({ thinkificUserId: Number(userId) });
                    if (profiles.length > 0 && profiles[0].level !== level) {
                        await base44.asServiceRole.entities.StudentProfile.update(profiles[0].id, { level });
                    }
                }

                created++;
            } catch (rowErr) {
                errors.push(`Row error: ${rowErr.message}`);
                skipped++;
            }
        }

        console.log(`[ingestHistoricalData] teacherEmail=${teacherEmail} created=${created} skipped=${skipped}`);

        return Response.json({ success: true, created, skipped, errors: errors.slice(0, 20) });
    } catch (error) {
        console.error('[ingestHistoricalData] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});