import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function getGroupStudents(groupId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/users?query[group_id]=${groupId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch group students: ${response.status}`);
    }

    const data = await response.json();
    return data.items || [];
}

async function getEnrollments(userId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error(`Failed to fetch enrollments for user ${userId}: ${response.status}`);
        return [];
    }

    const data = await response.json();
    return data.items || [];
}

async function getCourseProgress(userId, courseId) {
    const response = await fetch(`https://api.thinkific.com/api/public/v1/course_progress?query[user_id]=${userId}&query[course_id]=${courseId}`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    return data.items?.[0] || null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { groupId } = body;
        
        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        console.log('Fetching students for group:', groupId);
        const students = await getGroupStudents(groupId);
        console.log('Found students:', students.length);
        
        const lessonCompletions = [];

        // For each student, get their enrollments and lesson completions
        for (const student of students) {
            const enrollments = await getEnrollments(student.id);
            
            for (const enrollment of enrollments) {
                const progress = await getCourseProgress(student.id, enrollment.course_id);
                
                if (progress?.completed_chapter_ids) {
                    // Note: Thinkific REST API doesn't provide detailed lesson completion data
                    // We can only track chapter/section completions
                    progress.completed_chapter_ids.forEach((chapterId) => {
                        lessonCompletions.push({
                            studentId: String(student.id),
                            studentEmail: student.email,
                            studentName: `${student.first_name} ${student.last_name}`,
                            lessonId: String(chapterId),
                            lessonName: `Chapter ${chapterId}`,
                            courseId: String(enrollment.course_id),
                            courseName: enrollment.course_name || 'Unknown Course',
                            completedAt: new Date().toISOString()
                        });
                    });
                }
            }
        }

        // Bulk create lesson completions
        if (lessonCompletions.length > 0) {
            await base44.asServiceRole.entities.LessonCompletion.bulkCreate(lessonCompletions);
        }

        return Response.json({ 
            success: true, 
            lessonsImported: lessonCompletions.length,
            message: `Imported ${lessonCompletions.length} lesson completions for ${students.length} students`
        });
    } catch (error) {
        console.error('Sync historical lessons error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});