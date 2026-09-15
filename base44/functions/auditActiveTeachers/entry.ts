import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const AUDIT_TOKEN = '68c494a88995d808326fcff47751d24e5955e0fd390f6382122920d8b1a88d97';
const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';
const THINKIFIC_ACCESS_TOKEN = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
const THINKIFIC_API_KEY = Deno.env.get('THINKIFIC_API_KEY');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');
const CLASSROOM_COURSE_ID = Number(Deno.env.get('CLASSROOM_PRODUCT_ID') || '552235');

function thinkificHeaders() {
    if (THINKIFIC_ACCESS_TOKEN) {
        return {
            Authorization: `Bearer ${THINKIFIC_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        };
    }
    return {
        'X-Auth-API-Key': THINKIFIC_API_KEY || '',
        'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN || '',
        'Content-Type': 'application/json'
    };
}

async function thinkificGet(path) {
    const response = await fetch(`${THINKIFIC_BASE}${path}`, {
        headers: thinkificHeaders()
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Thinkific GET ${path} failed (${response.status}): ${body.slice(0, 300)}`);
    }
    return response.json();
}

async function listAll(path, maxPages = 100) {
    const results = [];
    let page = 1;

    while (page <= maxPages) {
        const separator = path.includes('?') ? '&' : '?';
        const data = await thinkificGet(`${path}${separator}page=${page}&limit=250`);
        const items = data.items || [];
        results.push(...items);

        const nextPage = data.meta?.pagination?.next_page;
        if (!nextPage) break;
        page = Number(nextPage);
    }

    return results;
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => runWorker())
    );
    return results;
}

function normalizeEmail(value) {
    return String(value || '').toLowerCase().trim();
}

function normalizeClassroomName(value) {
    return String(value || '')
        .normalize('NFKD')
        .toLowerCase()
        .replace(/\[id:\s*\d+\]/g, ' ')
        .replace(/’/g, "'")
        .replace(/\s*'s\s+classroom\s*$/i, '')
        .replace(/\s+classroom\s*$/i, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isActiveEnrollment(enrollment) {
    if (enrollment.expired === true) return false;
    const expiry = enrollment.expiry_date || enrollment.expires_at || null;
    if (expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= Date.now()) {
        return false;
    }
    return true;
}

function enrollmentUserId(enrollment) {
    return Number(enrollment.user_id || enrollment.user?.id || 0);
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        const body = await req.json();
        if (body.token !== AUDIT_TOKEN) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const mode = body.mode === 'repair' ? 'repair' : 'inspect';
        const base44 = createClientFromRequest(req);

        const enrollments = await listAll(
            `/enrollments?query[course_id]=${CLASSROOM_COURSE_ID}`
        );
        const activeEnrollments = enrollments.filter(isActiveEnrollment);
        const activeEnrollmentByUserId = new Map();

        for (const enrollment of activeEnrollments) {
            const userId = enrollmentUserId(enrollment);
            if (userId && !activeEnrollmentByUserId.has(userId)) {
                activeEnrollmentByUserId.set(userId, enrollment);
            }
        }

        const activeUserIds = Array.from(activeEnrollmentByUserId.keys());
        const users = await mapLimit(activeUserIds, 10, async (userId) => {
            try {
                return await thinkificGet(`/users/${userId}`);
            } catch (error) {
                return { id: userId, _error: error.message };
            }
        });
        const userById = new Map(users.map(user => [Number(user.id), user]));

        const groups = await listAll('/groups');
        const groupSnapshots = await mapLimit(groups, 8, async (group) => {
            try {
                const members = await listAll(`/users?query[group_id]=${group.id}`);
                return {
                    id: String(group.id),
                    name: group.name || '',
                    members,
                    error: null
                };
            } catch (error) {
                return {
                    id: String(group.id),
                    name: group.name || '',
                    members: [],
                    error: error.message
                };
            }
        });

        const existingTeacherGroups = await base44.asServiceRole.entities.TeacherGroup.list(
            'created_date',
            5000,
            0
        );
        const existingTeacherAccess = await base44.asServiceRole.entities.TeacherAccess.list(
            'created_date',
            5000,
            0
        );
        const existingStudentCodes = await base44.asServiceRole.entities.StudentAccessCode.list(
            'created_date',
            5000,
            0
        );

        const teacherGroupKeys = new Set(existingTeacherGroups.map(record =>
            `${normalizeEmail(record.teacherEmail)}|${String(record.thinkificGroupId)}`
        ));
        const studentCodeKeys = new Set(existingStudentCodes.map(record =>
            `${normalizeEmail(record.createdByTeacherEmail)}|${normalizeEmail(record.studentEmail)}`
        ));
        const accessByEmail = new Map(existingTeacherAccess.map(record =>
            [normalizeEmail(record.teacherEmail), record]
        ));

        const actions = {
            teacherGroupsCreated: 0,
            teacherAccessCreated: 0,
            teacherAccessReactivated: 0,
            studentLinksCreated: 0,
            errors: []
        };

        const teacherReports = [];

        for (const userId of activeUserIds) {
            const user = userById.get(Number(userId)) || { id: userId };
            const teacherEmail = normalizeEmail(user.email);
            const enrollment = activeEnrollmentByUserId.get(Number(userId));
            const memberGroups = groupSnapshots.filter(group =>
                group.members.some(member => Number(member.id) === Number(userId))
            );
            const teacherNameKey = normalizeClassroomName(
                `${user.first_name || ''} ${user.last_name || ''}`
            );
            const matchedGroups = memberGroups.filter(group => {
                const groupNameKey = normalizeClassroomName(group.name);
                const nameMatches = teacherNameKey.length >= 5 && (
                    groupNameKey.includes(teacherNameKey) || teacherNameKey.includes(groupNameKey)
                );
                const modalStudents = group.members.filter(member =>
                    normalizeEmail(member.email).endsWith('@modalmath.com') &&
                    Number(member.id) !== Number(userId)
                );
                const nonModalMembers = group.members.filter(member =>
                    !normalizeEmail(member.email).endsWith('@modalmath.com')
                );
                const soleNonModalOwner = !teacherEmail.endsWith('@modalmath.com') &&
                    modalStudents.length > 0 &&
                    nonModalMembers.length === 1 &&
                    Number(nonModalMembers[0].id) === Number(userId);

                return nameMatches || soleNonModalOwner;
            });

            const groupReports = matchedGroups.map(group => {
                const students = group.members.filter(member =>
                    normalizeEmail(member.email).endsWith('@modalmath.com') &&
                    Number(member.id) !== Number(userId)
                );
                const groupKey = `${teacherEmail}|${group.id}`;
                const missingStudentLinks = students.filter(student =>
                    !studentCodeKeys.has(`${teacherEmail}|${normalizeEmail(student.email)}`)
                );

                return {
                    id: group.id,
                    name: group.name,
                    memberCount: group.members.length,
                    studentCount: students.length,
                    hasBase44Mapping: teacherGroupKeys.has(groupKey),
                    missingStudentLinkCount: missingStudentLinks.length,
                    students: students.map(student => ({
                        id: Number(student.id),
                        email: normalizeEmail(student.email),
                        name: `${student.first_name || ''} ${student.last_name || ''}`.trim()
                    }))
                };
            });

            const accessRecord = accessByEmail.get(teacherEmail);
            const hasExistingGroupMapping = existingTeacherGroups.some(record =>
                normalizeEmail(record.teacherEmail) === teacherEmail
            );
            const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
            const isTestAccount = /^test/i.test(teacherEmail) || /\btest\b/i.test(displayName);
            const isTeacherCandidate = Boolean(
                !isTestAccount && teacherEmail && (
                    !teacherEmail.endsWith('@modalmath.com') ||
                    matchedGroups.length > 0 ||
                    accessRecord ||
                    hasExistingGroupMapping
                )
            );
            if (!isTeacherCandidate) continue;

            const issues = [];
            if (!teacherEmail) issues.push('Thinkific user has no email');
            if (user._error) issues.push(`Thinkific user lookup failed: ${user._error}`);
            if (matchedGroups.length === 0) issues.push('No Thinkific classroom group membership found');
            if (!accessRecord) issues.push('Missing Base44 TeacherAccess');
            if (accessRecord && accessRecord.status !== 'active') {
                issues.push(`Base44 TeacherAccess status is ${accessRecord.status}`);
            }
            for (const group of groupReports) {
                if (!group.hasBase44Mapping) {
                    issues.push(`Missing Base44 TeacherGroup for group ${group.id}`);
                }
                if (group.missingStudentLinkCount > 0) {
                    issues.push(`${group.missingStudentLinkCount} missing student links for group ${group.id}`);
                }
            }

            if (mode === 'repair' && isTeacherCandidate && teacherEmail) {
                try {
                    if (!accessRecord) {
                        const created = await base44.asServiceRole.entities.TeacherAccess.create({
                            teacherEmail,
                            thinkificUserId: String(userId),
                            status: 'active',
                            currentPeriodEndAt: enrollment.expiry_date || enrollment.expires_at || null,
                            currentPeriodEndSource: 'thinkific_active_enrollment'
                        });
                        accessByEmail.set(teacherEmail, created);
                        actions.teacherAccessCreated++;
                    } else if (accessRecord.status !== 'active') {
                        await base44.asServiceRole.entities.TeacherAccess.update(accessRecord.id, {
                            status: 'active',
                            thinkificUserId: String(userId),
                            currentPeriodEndAt: enrollment.expiry_date || enrollment.expires_at || null,
                            currentPeriodEndSource: 'thinkific_active_enrollment'
                        });
                        actions.teacherAccessReactivated++;
                    }
                } catch (error) {
                    actions.errors.push({
                        teacherEmail,
                        action: 'teacher-access',
                        error: error.message
                    });
                }

                for (const group of matchedGroups) {
                    const groupKey = `${teacherEmail}|${group.id}`;
                    if (!teacherGroupKeys.has(groupKey)) {
                        try {
                            await base44.asServiceRole.entities.TeacherGroup.create({
                                teacherEmail,
                                teacherThinkificUserId: String(userId),
                                thinkificGroupId: group.id,
                                thinkificGroupName: group.name
                            });
                            teacherGroupKeys.add(groupKey);
                            actions.teacherGroupsCreated++;
                        } catch (error) {
                            actions.errors.push({
                                teacherEmail,
                                action: 'teacher-group',
                                groupId: group.id,
                                error: error.message
                            });
                        }
                    }

                    const students = group.members.filter(member =>
                        normalizeEmail(member.email).endsWith('@modalmath.com') &&
                        !activeTeacherIds.has(Number(member.id))
                    );
                    for (const student of students) {
                        const studentEmail = normalizeEmail(student.email);
                        const studentKey = `${teacherEmail}|${studentEmail}`;
                        if (!studentCodeKeys.has(studentKey)) {
                            try {
                                await base44.asServiceRole.entities.StudentAccessCode.create({
                                    studentEmail,
                                    createdAt: new Date().toISOString(),
                                    createdByTeacherEmail: teacherEmail
                                });
                                studentCodeKeys.add(studentKey);
                                actions.studentLinksCreated++;
                            } catch (error) {
                                actions.errors.push({
                                    teacherEmail,
                                    action: 'student-link',
                                    studentEmail,
                                    error: error.message
                                });
                            }
                        }
                    }
                }
            }

            teacherReports.push({
                userId: Number(userId),
                email: teacherEmail,
                name: displayName,
                enrollmentId: enrollment.id || null,
                expiryDate: enrollment.expiry_date || enrollment.expires_at || null,
                base44AccessStatus: accessRecord?.status || null,
                groups: groupReports,
                issues
            });
        }

        return Response.json({
            mode,
            classroomCourseId: CLASSROOM_COURSE_ID,
            summary: {
                enrollmentCount: enrollments.length,
                activeTeacherCount: teacherReports.length,
                skippedNonTeacherOrTestEnrollments: activeUserIds.length - teacherReports.length,
                thinkificGroupCount: groups.length,
                groupReadErrors: groupSnapshots.filter(group => group.error).length,
                teachersWithoutGroup: teacherReports.filter(teacher => teacher.groups.length === 0).length,
                teachersWithIssues: teacherReports.filter(teacher => teacher.issues.length > 0).length
            },
            actions,
            teachers: teacherReports,
            groupReadErrors: groupSnapshots
                .filter(group => group.error)
                .map(group => ({ id: group.id, name: group.name, error: group.error }))
        });
    } catch (error) {
        console.error('[ACTIVE TEACHER AUDIT]', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
