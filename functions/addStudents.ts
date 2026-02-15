import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

async function hashCode(code) {
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const STUDENT_PRODUCT_ID = Deno.env.get("STUDENT_PRODUCT_ID");
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const CLASSROOM_COURSE_ID = '552235';

const COURSE_IDS = {
    PK: Deno.env.get("COURSE_ID_PK"),
    K: Deno.env.get("COURSE_ID_K"),
    L1: Deno.env.get("COURSE_ID_L1"),
    L2: Deno.env.get("COURSE_ID_L2"),
    L3: Deno.env.get("COURSE_ID_L3"),
    L4: Deno.env.get("COURSE_ID_L4"),
    L5: Deno.env.get("COURSE_ID_L5")
};

async function verifySession(token) {
    if (!token) {
        throw new Error('Unauthorized');
    }

    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    
    return payload;
}

function generateStudentEmail(firstName, lastInitial) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lastInitial.toLowerCase().replace(/[^a-z]/g, '');
    return `${cleanFirst}${cleanLast}${randomDigits}@modalmath.com`;
}

async function createThinkificUser(firstName, lastInitial, email) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/users', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            first_name: firstName,
            last_name: lastInitial,
            email: email,
            password: 'Math1234!',
            send_welcome_email: false
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create user');
    }

    return await response.json();
}

async function addToGroup(userId, groupId) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/group_memberships', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: userId,
            group_id: groupId
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('Add to group failed:', { status: response.status, error, userId, groupId });
        throw new Error(error.message || `Failed to add to group (${response.status})`);
    }

    return await response.json();
}

async function enrollInStudentBundle(userId) {
    const response = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
        method: 'POST',
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            user_id: userId,
            product_id: STUDENT_PRODUCT_ID,
            activated_at: new Date().toISOString()
        })
    });

    if (!response.ok) {
        const error = await response.json();
        console.error('Enrollment error:', error);
    }

    return response.ok;
}

async function enrollInCourses(userId) {
    const enrollments = [];
    
    for (const [level, courseId] of Object.entries(COURSE_IDS)) {
        if (!courseId) continue;
        
        try {
            const response = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
                method: 'POST',
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_id: userId,
                    course_id: courseId,
                    activated_at: new Date().toISOString()
                })
            });

            if (response.ok) {
                enrollments.push(level);
            }
        } catch (error) {
            console.error(`Failed to enroll in ${level}:`, error);
        }
    }
    
    return enrollments;
}

async function checkActiveEnrollment(userEmail) {
    const response = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(userEmail)}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        }
    );

    if (!response.ok) {
        throw new Error('Failed to fetch user');
    }

    const userData = await response.json();
    const userId = userData.items?.[0]?.id;
    
    if (!userId) {
        throw new Error('User not found');
    }

    const enrollmentsResponse = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}`,
        {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
            }
        }
    );

    if (!enrollmentsResponse.ok) {
        throw new Error('Failed to fetch enrollments');
    }

    const enrollmentsData = await enrollmentsResponse.json();
    const hasActiveClassroomEnrollment = enrollmentsData.items?.some(
        e => String(e.course_id) === CLASSROOM_COURSE_ID && e.status === 'active'
    );

    return hasActiveClassroomEnrollment;
}

async function getActiveStudentCount(groupId, base44) {
    let allMembers = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(
            `https://api.thinkific.com/api/public/v1/group_memberships?group_id=${groupId}&page=${page}&limit=25`,
            {
                headers: {
                    'X-Auth-API-Key': THINKIFIC_API_KEY,
                    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN
                }
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch group members');
        }

        const data = await response.json();
        allMembers.push(...data.items);
        hasMore = data.meta.pagination.current_page < data.meta.pagination.total_pages;
        page++;
    }

    const studentEmails = allMembers
        .map(m => m.user?.email?.toLowerCase().trim())
        .filter(email => email && email.endsWith('@modalmath.com'));

    const archivedStudents = await base44.asServiceRole.entities.ArchivedStudent.filter({ groupId: groupId });
    const archivedEmailSet = new Set(archivedStudents.map(s => s.studentEmail?.toLowerCase().trim()));

    const activeStudents = studentEmails.filter(email => !archivedEmailSet.has(email));
    return activeStudents.length;
}

Deno.serve(async (req) => {
    try {
        const { students, groupId, sessionToken } = await req.json();
        const session = await verifySession(sessionToken);
        const base44 = createClientFromRequest(req);

        const isActive = await checkActiveEnrollment(session.email);
        if (!isActive) {
            return Response.json({ 
                error: 'Your enrollment is not active. You can only view the dashboard but cannot add students.' 
            }, { status: 403 });
        }

        if (!students || !Array.isArray(students) || students.length === 0) {
            return Response.json({ error: 'Students array required' }, { status: 400 });
        }

        if (students.length > 10) {
            return Response.json({ error: 'Maximum 10 students per request' }, { status: 400 });
        }

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        const activeCount = await getActiveStudentCount(groupId, base44);
        const slotsRemaining = 10 - activeCount;

        if (slotsRemaining <= 0) {
            console.log(`Roster cap blocked: teacher=${session.email}, groupId=${groupId}, activeCount=${activeCount}, requestedAdds=${students.length}`);
            return Response.json({ 
                error: 'Roster limit reached (10 active students). Archive or remove a student before adding more.' 
            }, { status: 400 });
        }

        if (students.length > slotsRemaining) {
            console.log(`Roster cap blocked: teacher=${session.email}, groupId=${groupId}, activeCount=${activeCount}, requestedAdds=${students.length}`);
            return Response.json({ 
                error: `You can only add ${slotsRemaining} more student(s). Roster max is 10 active students.` 
            }, { status: 400 });
        }

        const results = [];

        for (const student of students) {
            try {
                const email = generateStudentEmail(student.firstName, student.lastInitial);
                
                // Create user
                const user = await createThinkificUser(student.firstName, student.lastInitial, email);
                
                // Generate access code for student portal login
                const accessCode = Math.random().toString(36).substring(2, 10).toUpperCase();
                const hashedCode = await hashCode(accessCode);
                
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: email.toLowerCase().trim(),
                    codeHash: hashedCode,
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: session.email
                });
                
                // Add to group
                await addToGroup(user.id, groupId);
                
                // Enroll in student bundle
                await enrollInStudentBundle(user.id);
                
                // Enroll in courses PK, L1, L2, L3, L4, L5
                await enrollInCourses(user.id);

                results.push({
                    success: true,
                    student: {
                        id: user.id,
                        firstName: student.firstName,
                        lastInitial: student.lastInitial,
                        email: email,
                        password: 'Math1234!',
                        accessCode: accessCode
                    }
                });

            } catch (error) {
                results.push({
                    success: false,
                    firstName: student.firstName,
                    error: error.message
                });
            }
        }

        return Response.json({ results });

    } catch (error) {
        console.error('Add students error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});