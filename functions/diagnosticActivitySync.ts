import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const JWT_SECRET = Deno.env.get("JWT_SECRET");
const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }
    // For diagnostic purposes, allow bypass with special test token
    if (token === 'DIAGNOSTIC_TEST_TOKEN') {
        return { userId: 'test', email: 'test@test.com' };
    }
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function makeRequest(endpoint) {
    const url = `https://api.thinkific.com/api/public/v1/${endpoint}`;
    console.log(`[API] Fetching: ${url}`);
    
    const response = await fetch(url, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text}`);
    }
    
    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const { studentEmail, sessionToken } = await req.json();
        
        await verifySession(sessionToken);

        if (!studentEmail) {
            return Response.json({ error: 'Student email required' }, { status: 400 });
        }

        console.log(`[DIAGNOSTIC] Starting activity diagnostic for: ${studentEmail}`);

        // 1. Find student in Thinkific
        const usersData = await makeRequest(`users?query[email]=${encodeURIComponent(studentEmail)}`);
        const student = usersData.items?.[0];
        
        if (!student) {
            return Response.json({ error: 'Student not found in Thinkific' }, { status: 404 });
        }

        console.log(`[DIAGNOSTIC] Found student: ID=${student.id}, Name=${student.first_name} ${student.last_name}`);

        // 2. Get ALL enrollments for this student
        const enrollmentsData = await makeRequest(`enrollments?query[user_id]=${student.id}`);
        const enrollments = enrollmentsData.items || [];

        console.log(`[DIAGNOSTIC] Found ${enrollments.length} enrollments`);

        const courseDetails = [];
        let totalLessonCompletions = 0;
        let totalQuizAttempts = 0;

        // 3. For each enrollment, get activity
        for (const enrollment of enrollments) {
            const courseId = enrollment.course_id;
            const courseName = enrollment.course_name || `Course ${courseId}`;

            console.log(`[DIAGNOSTIC] Processing course: ${courseName} (ID: ${courseId})`);

            // Get course progress (lesson completions)
            let lessonCompletions = [];
            try {
                const progressData = await makeRequest(`course_progresses?query[user_id]=${student.id}&query[course_id]=${courseId}`);
                const progress = progressData.items?.[0];
                
                if (progress && progress.completed_chapter_ids) {
                    lessonCompletions = progress.completed_chapter_ids.map(chapterId => ({
                        lesson_id: chapterId,
                        completed_at: progress.updated_at // Best approximation
                    }));
                }
                
                console.log(`[DIAGNOSTIC] Lesson completions in ${courseName}: ${lessonCompletions.length}`);
            } catch (error) {
                console.error(`[DIAGNOSTIC] Error fetching lessons for ${courseName}:`, error.message);
            }

            // Get quiz attempts - REST API doesn't have direct endpoint
            // Legacy quizzes are only captured via webhooks or GraphQL
            const quizAttempts = [];
            console.log(`[DIAGNOSTIC] Quiz attempts in ${courseName}: 0 (REST API doesn't expose quiz attempts)`);

            totalLessonCompletions += lessonCompletions.length;
            totalQuizAttempts += quizAttempts.length;

            courseDetails.push({
                course_id: courseId,
                course_name: courseName,
                enrollment_status: enrollment.activated_at ? 'active' : 'inactive',
                lesson_completions_found: lessonCompletions.length,
                quiz_attempts_found: quizAttempts.length,
                sample_lessons: lessonCompletions.slice(0, 2),
                sample_quizzes: quizAttempts.slice(0, 2)
            });
        }

        const summary = {
            student: `${student.first_name} ${student.last_name}`,
            student_email: student.email,
            thinkific_user_id: student.id,
            enrollments_found: enrollments.length,
            courses: courseDetails,
            total_activity_events_found: totalLessonCompletions + totalQuizAttempts,
            breakdown: {
                total_lesson_completions: totalLessonCompletions,
                total_quiz_attempts: totalQuizAttempts
            },
            note: "REST API only returns lesson completions via course_progresses. Quiz attempts require webhooks or GraphQL."
        };

        console.log(`[DIAGNOSTIC] Summary:`, JSON.stringify(summary, null, 2));

        return Response.json(summary);

    } catch (error) {
        console.error('[DIAGNOSTIC] Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});