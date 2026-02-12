import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { ThinkificClient } from './lib/thinkificClient.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        const { groupId } = await req.json();

        console.log('=== THINKIFIC DIAGNOSTIC REPORT ===');
        console.log(`Timestamp: ${new Date().toISOString()}`);
        console.log(`Group ID: ${groupId}`);

        const report = {
            timestamp: new Date().toISOString(),
            groupId,
            api: {},
            database: {},
            webhooks: {}
        };

        // API Diagnostics
        try {
            console.log('\n--- API DIAGNOSTICS ---');
            
            const allUsers = await ThinkificClient.getGroupUsers(groupId);
            const students = allUsers.filter(u => u.email?.toLowerCase().endsWith('@modalmath.com'));
            const teachers = allUsers.filter(u => !u.email?.toLowerCase().endsWith('@modalmath.com'));

            report.api.users = {
                total: allUsers.length,
                students: students.length,
                teachers: teachers.length,
                sample: students[0] || null
            };

            if (students.length > 0) {
                const sampleStudent = students[0];
                const enrollments = await ThinkificClient.getEnrollmentsByUser(sampleStudent.id);
                const progress = await ThinkificClient.getAllCourseProgressForUser(sampleStudent.id);
                const events = await ThinkificClient.getUserEvents(sampleStudent.id, 'user.sign_in');

                report.api.sampleStudent = {
                    email: sampleStudent.email,
                    enrollments: enrollments.length,
                    courseProgress: progress.length,
                    signInEvents: events.length,
                    latestSignIn: events[0]?.occurred_at || null
                };

                console.log(`Sample student: ${sampleStudent.email}`);
                console.log(`  - Enrollments: ${enrollments.length}`);
                console.log(`  - Course progress: ${progress.length}`);
                console.log(`  - Sign-in events: ${events.length}`);
            }

        } catch (error) {
            report.api.error = error.message;
            console.error('API Error:', error);
        }

        // Database Diagnostics
        try {
            console.log('\n--- DATABASE DIAGNOSTICS ---');
            
            const quizzes = await base44.asServiceRole.entities.QuizCompletion.list('-completedAt', 100);
            const lessons = await base44.asServiceRole.entities.LessonCompletion.list('-completedAt', 100);
            const webhooks = await base44.asServiceRole.entities.WebhookEvent.list('-receivedAt', 50);

            report.database = {
                quizCompletions: quizzes.length,
                lessonCompletions: lessons.length,
                webhookEvents: webhooks.length,
                latestQuiz: quizzes[0] || null,
                latestLesson: lessons[0] || null,
                latestWebhook: webhooks[0] || null
            };

            console.log(`Quiz completions: ${quizzes.length}`);
            console.log(`Lesson completions: ${lessons.length}`);
            console.log(`Webhook events: ${webhooks.length}`);

        } catch (error) {
            report.database.error = error.message;
            console.error('Database Error:', error);
        }

        // Webhook Topic Analysis
        try {
            console.log('\n--- WEBHOOK ANALYSIS ---');
            
            const allWebhooks = await base44.asServiceRole.entities.WebhookEvent.list('-receivedAt', 1000);
            const topics = {};
            
            allWebhooks.forEach(wh => {
                topics[wh.topic] = (topics[wh.topic] || 0) + 1;
            });

            report.webhooks.topicCounts = topics;
            report.webhooks.total = allWebhooks.length;

            console.log('Webhook topics received:');
            Object.entries(topics).forEach(([topic, count]) => {
                console.log(`  - ${topic}: ${count}`);
            });

        } catch (error) {
            report.webhooks.error = error.message;
            console.error('Webhook Analysis Error:', error);
        }

        console.log('\n=== END DIAGNOSTIC REPORT ===');

        return Response.json(report);

    } catch (error) {
        console.error('Diagnostic error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});