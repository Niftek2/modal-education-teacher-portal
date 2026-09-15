import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';
import { jwtVerify } from 'npm:jose@5.9.6';

const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';
const CLASSROOM_PRODUCT_ID = String(Deno.env.get('CLASSROOM_PRODUCT_ID') || '552235');

function normalizeEmail(value) {
    return String(value || '').toLowerCase().trim();
}

function isActiveEnrollment(enrollment) {
    if (enrollment.expired === true) return false;
    const expiry = enrollment.expiry_date || enrollment.expires_at || null;
    if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= Date.now()) {
        return false;
    }
    return true;
}

function thinkificHeaders() {
    const accessToken = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
    if (accessToken) {
        return {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    return {
        'X-Auth-API-Key': Deno.env.get('THINKIFIC_API_KEY') || '',
        'X-Auth-Subdomain': Deno.env.get('THINKIFIC_SUBDOMAIN') || '',
        'Content-Type': 'application/json'
    };
}

async function requireSession(token) {
    if (!token) return null;
    try {
        const secret = new TextEncoder().encode(Deno.env.get('JWT_SECRET'));
        const { payload } = await jwtVerify(token, secret);
        if (payload.type !== 'session' || !payload.userId || !payload.email) return null;
        return payload;
    } catch {
        return null;
    }
}

async function thinkificRequest(path, options = {}) {
    const response = await fetch(`${THINKIFIC_BASE}${path}`, {
        ...options,
        headers: {
            ...thinkificHeaders(),
            ...(options.headers || {})
        }
    });

    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { message: text };
        }
    }

    if (!response.ok) {
        throw new Error(data?.message || data?.error || `Thinkific request failed with status ${response.status}`);
    }

    return data;
}

async function listAll(path, maxPages = 100) {
    const results = [];
    let page = 1;

    while (page <= maxPages) {
        const separator = path.includes('?') ? '&' : '?';
        const data = await thinkificRequest(`${path}${separator}page=${page}&limit=250`);
        const items = data?.items || [];
        results.push(...items);

        const nextPage = data?.meta?.pagination?.next_page;
        if (!nextPage) break;
        page = Number(nextPage);
    }

    return results;
}

async function getGroupMembers(groupId) {
    return listAll(`/users?query[group_id]=${encodeURIComponent(groupId)}`);
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const headerToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
        const session = await requireSession(headerToken || body.sessionToken);

        if (!session) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const base44 = createClientFromRequest(req);
        const teacherEmail = normalizeEmail(session.email);
        const teacherUserId = Number(session.userId);

        const accessRecords = await base44.asServiceRole.entities.TeacherAccess.filter({
            teacherEmail
        });
        const activeAccess = accessRecords.find(record => record.status === 'active');
        if (!activeAccess) {
            return Response.json({
                error: 'Classroom setup is not available for this account. Please contact Modal Math support.'
            }, { status: 403 });
        }

        const [teacher, enrollments] = await Promise.all([
            thinkificRequest(`/users/${teacherUserId}`),
            listAll(
                `/enrollments?query[user_id]=${teacherUserId}&query[course_id]=${encodeURIComponent(CLASSROOM_PRODUCT_ID)}`
            )
        ]);

        if (normalizeEmail(teacher?.email) !== teacherEmail) {
            return Response.json({ error: 'Account verification failed' }, { status: 403 });
        }

        if (!enrollments.some(isActiveEnrollment)) {
            return Response.json({
                error: 'An active Your Classroom enrollment is required.'
            }, { status: 403 });
        }

        const existingMappings = await base44.asServiceRole.entities.TeacherGroup.filter({
            teacherEmail
        });
        if (existingMappings.length > 0) {
            const mapping = existingMappings[0];
            return Response.json({
                success: true,
                created: false,
                group: {
                    id: String(mapping.thinkificGroupId),
                    name: mapping.thinkificGroupName
                }
            });
        }

        const fullName = `${teacher?.first_name || ''} ${teacher?.last_name || ''}`.trim() || teacherEmail;
        const baseGroupName = `${fullName}'s Classroom`;
        const uniqueGroupName = `${baseGroupName} [ID: ${teacherUserId}]`;
        const allGroups = await listAll('/groups');

        let group = null;
        const exactCandidates = allGroups.filter(candidate =>
            candidate.name === baseGroupName || candidate.name === uniqueGroupName
        );

        for (const candidate of exactCandidates) {
            const members = await getGroupMembers(candidate.id);
            if (members.some(member => Number(member.id) === teacherUserId)) {
                group = candidate;
                break;
            }
        }

        if (!group) {
            const baseNameTaken = allGroups.some(candidate => candidate.name === baseGroupName);
            const desiredName = baseNameTaken ? uniqueGroupName : baseGroupName;
            group = allGroups.find(candidate => candidate.name === desiredName) || null;

            if (!group) {
                group = await thinkificRequest('/groups', {
                    method: 'POST',
                    body: JSON.stringify({ name: desiredName })
                });
            }

            const members = await getGroupMembers(group.id);
            const alreadyMember = members.some(member => Number(member.id) === teacherUserId);

            if (!alreadyMember) {
                await thinkificRequest('/group_users', {
                    method: 'POST',
                    body: JSON.stringify({
                        group_id: Number(group.id),
                        user_id: teacherUserId
                    })
                });
            }
        }

        const duplicateCheck = await base44.asServiceRole.entities.TeacherGroup.filter({
            teacherEmail,
            thinkificGroupId: String(group.id)
        });

        if (duplicateCheck.length === 0) {
            await base44.asServiceRole.entities.TeacherGroup.create({
                teacherEmail,
                teacherThinkificUserId: String(teacherUserId),
                thinkificGroupId: String(group.id),
                thinkificGroupName: group.name
            });
        }

        return Response.json({
            success: true,
            created: true,
            group: {
                id: String(group.id),
                name: group.name
            }
        });
    } catch (error) {
        console.error('[SETUP TEACHER CLASSROOM]', error);
        return Response.json({
            error: 'We could not set up your classroom right now. Please try again or contact Modal Math support.'
        }, { status: 500 });
    }
});
