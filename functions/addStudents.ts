import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const STUDENT_PRODUCT_ID = Deno.env.get("STUDENT_PRODUCT_ID");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(req) {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        throw new Error('Unauthorized');
    }

    const token = authHeader.substring(7);
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
        throw new Error('Failed to add to group');
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

Deno.serve(async (req) => {
    try {
        await verifySession(req);
        const { students, groupId } = await req.json();

        if (!students || !Array.isArray(students) || students.length === 0) {
            return Response.json({ error: 'Students array required' }, { status: 400 });
        }

        if (students.length > 10) {
            return Response.json({ error: 'Maximum 10 students per request' }, { status: 400 });
        }

        if (!groupId) {
            return Response.json({ error: 'Group ID required' }, { status: 400 });
        }

        const results = [];

        for (const student of students) {
            try {
                const email = generateStudentEmail(student.firstName, student.lastInitial);
                
                // Create user
                const user = await createThinkificUser(student.firstName, student.lastInitial, email);
                
                // Add to group
                await addToGroup(user.id, groupId);
                
                // Enroll in student bundle
                await enrollInStudentBundle(user.id);

                results.push({
                    success: true,
                    student: {
                        id: user.id,
                        firstName: student.firstName,
                        lastInitial: student.lastInitial,
                        email: email,
                        password: 'Math1234!'
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