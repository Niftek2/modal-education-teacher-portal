import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

async function queryThinkificGraphQL(query, variables) {
    const response = await fetch(`https://api.thinkific.com/graphql`, {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, variables })
    });

    const data = await response.json();
    if (data.errors) {
        throw new Error(`GraphQL Error: ${data.errors[0].message}`);
    }

    return data.data;
}

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

async function getStudentLessonCompletions(userId) {
    try {
        const query = `
            query GetStudentLessons($userId: ID!) {
                user(id: $userId) {
                    enrollments {
                        course {
                            id
                            name
                            lessons {
                                id
                                name
                                userProgress {
                                    completedAt
                                }
                            }
                        }
                    }
                }
            }
        `;

        const result = await queryThinkificGraphQL(query, { userId });
        
        if (!result.user || !result.user.enrollments) {
            return [];
        }

        const lessons = [];
        result.user.enrollments.forEach(enrollment => {
            enrollment.course.lessons.forEach(lesson => {
                if (lesson.userProgress?.completedAt) {
                    lessons.push({
                        id: lesson.id,
                        name: lesson.name,
                        chapter: {
                            course: {
                                id: enrollment.course.id,
                                name: enrollment.course.name
                            }
                        },
                        completedAt: lesson.userProgress.completedAt
                    });
                }
            });
        });

        return lessons;
    } catch (error) {
        console.error('Failed to fetch lesson completions:', error);
        return [];
    }
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { groupId } = body;
        
        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        // Get all students in group
        console.log('Fetching students for group:', groupId);
        const students = await getGroupStudents(groupId);
        console.log('Found students:', students.length);
        
        let totalLessons = 0;
        const lessonCompletions = [];

        // Fetch lessons for each student
        for (const student of students) {
            const lessons = await getStudentLessonCompletions(student.id);
            
            lessons.forEach(lesson => {
                lessonCompletions.push({
                    studentId: student.id,
                    studentEmail: student.email,
                    studentName: `${student.first_name} ${student.last_name}`,
                    lessonId: lesson.id,
                    lessonName: lesson.name,
                    courseId: lesson.chapter?.course?.id,
                    courseName: lesson.chapter?.course?.name,
                    completedAt: lesson.completedAt
                });
            });

            totalLessons += lessons.length;
        }

        // Bulk create lesson completions
        if (lessonCompletions.length > 0) {
            await base44.asServiceRole.entities.LessonCompletion.bulkCreate(lessonCompletions);
        }

        return Response.json({ 
            success: true, 
            lessonsImported: totalLessons,
            message: `Imported ${totalLessons} lesson completions for ${students.length} students`
        });
    } catch (error) {
        console.error('Sync historical lessons error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});