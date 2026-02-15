import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const CLASSROOM_COURSE_ID = '552235';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        console.log(`[DIAGNOSTIC] Fetching enrollments for course ${CLASSROOM_COURSE_ID}`);
        
        const allEnrollments = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `https://api.thinkific.com/api/public/v1/enrollments?query[course_id]=${CLASSROOM_COURSE_ID}&page=${page}&limit=100`;
            console.log(`[DIAGNOSTIC] Fetching page ${page}: ${url}`);
            
            const response = await fetch(url, {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[DIAGNOSTIC] API Error (${response.status}):`, errorText);
                return Response.json({ 
                    error: `Thinkific API error: ${response.status}`,
                    details: errorText,
                    url: url
                }, { status: 500 });
            }

            const data = await response.json();
            allEnrollments.push(...data.items);
            
            console.log(`[DIAGNOSTIC] Page ${page}: ${data.items.length} enrollments`);
            
            hasMore = data.meta.pagination.current_page < data.meta.pagination.total_pages;
            page++;
        }

        // Filter for active enrollments only
        const activeEnrollments = allEnrollments.filter(e => e.status === 'active');

        // Group by email domain
        const modalMathEmails = [];
        const otherEmails = [];

        for (const enrollment of activeEnrollments) {
            const email = enrollment.user?.email?.toLowerCase().trim();
            if (email) {
                if (email.endsWith('@modalmath.com')) {
                    modalMathEmails.push({
                        userId: enrollment.user.id,
                        email: email,
                        firstName: enrollment.user.first_name,
                        lastName: enrollment.user.last_name,
                        enrolledAt: enrollment.created_at,
                        percentComplete: enrollment.percentage_completed
                    });
                } else {
                    otherEmails.push({
                        userId: enrollment.user.id,
                        email: email,
                        firstName: enrollment.user.first_name,
                        lastName: enrollment.user.last_name,
                        enrolledAt: enrollment.created_at,
                        percentComplete: enrollment.percentage_completed
                    });
                }
            }
        }

        return Response.json({
            courseId: CLASSROOM_COURSE_ID,
            courseName: 'Your Classroom',
            totalEnrollments: allEnrollments.length,
            activeEnrollments: activeEnrollments.length,
            breakdown: {
                modalMathStudents: modalMathEmails.length,
                potentialTeachers: otherEmails.length
            },
            modalMathStudents: modalMathEmails,
            potentialTeachers: otherEmails
        });

    } catch (error) {
        console.error('[DIAGNOSTIC] Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});