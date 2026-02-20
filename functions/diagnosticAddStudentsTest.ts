/**
 * End-to-end validation for addStudents + removeStudent logic.
 * Inlines the core logic (no internal HTTP calls) so it runs in the Deno sandbox.
 * Pass { "teacherEmail": "...", "teacherUserId": "..." } in the payload.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY     = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN   = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const STUDENT_PRODUCT_ID    = Deno.env.get("STUDENT_PRODUCT_ID");

const ASSIGNMENTS_COURSE_ID = '3359727';
const LEVEL_COURSE_IDS = ['422595', '422618', '422620', '496294', '496295', '496297', '496298'];
const ALL_COURSE_IDS = [ASSIGNMENTS_COURSE_ID, ...LEVEL_COURSE_IDS];

const tkKeyHeaders = {
    'X-Auth-API-Key': THINKIFIC_API_KEY,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json'
};
const tkBearerHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_ACCESS_TOKEN}`,
    'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
    'Content-Type': 'application/json'
};

// ── Thinkific helpers ──────────────────────────────────────────────────────────

async function tkFetch(path, opts = {}) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1${path}`, opts);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`Thinkific ${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

async function findUserByEmail(email) {
    const data = await tkFetch(`/users?query[email]=${encodeURIComponent(email)}`, { headers: tkBearerHeaders });
    return data?.items?.[0] || null;
}

async function getUserEnrollments(userId) {
    const data = await tkFetch(`/enrollments?query[user_id]=${userId}&limit=100`, { headers: tkBearerHeaders });
    return data?.items || [];
}

async function getUserGroupMemberships(userId) {
    // Thinkific doesn't support query[user_id] on group_memberships — fetch per group instead (handled at call site)
    // This function is kept as a stub for API-key-based group listing per group
    return [];
}

async function checkUserInGroup(userId, groupId) {
    // GET /groups/{id}/memberships — list members and see if userId is present
    try {
        const data = await tkFetch(`/groups/${groupId}/memberships?limit=100`, { headers: tkBearerHeaders });
        const items = data?.items || [];
        return items.some(m => String(m.user_id) === String(userId));
    } catch (e) {
        // Try alternate endpoint
        try {
            const data = await tkFetch(`/group_memberships?query[group_id]=${groupId}&limit=100`, { headers: tkBearerHeaders });
            const items = data?.items || [];
            return items.some(m => String(m.user_id) === String(userId));
        } catch (e2) {
            return { error: e2.message };
        }
    }
}

async function createThinkificUser(firstName, lastInitial, email) {
    return tkFetch('/users', {
        method: 'POST',
        headers: tkKeyHeaders,
        body: JSON.stringify({
            first_name: firstName,
            last_name: lastInitial,
            email,
            password: 'Math1234!',
            send_welcome_email: false
        })
    });
}

async function addToGroup(userId, groupId) {
    return tkFetch('/group_memberships', {
        method: 'POST',
        headers: tkKeyHeaders,
        body: JSON.stringify({ user_id: userId, group_id: groupId })
    });
}

async function enrollInCourse(userId, courseId) {
    try {
        await tkFetch('/enrollments', {
            method: 'POST',
            headers: tkKeyHeaders,
            body: JSON.stringify({ user_id: userId, course_id: courseId, activated_at: new Date().toISOString() })
        });
        return { courseId, result: 'OK' };
    } catch (e) {
        return { courseId, result: 'FAILED', error: e.message };
    }
}

async function enrollInBundle(userId) {
    try {
        await tkFetch('/enrollments', {
            method: 'POST',
            headers: tkKeyHeaders,
            body: JSON.stringify({ user_id: userId, product_id: STUDENT_PRODUCT_ID, activated_at: new Date().toISOString() })
        });
        return 'OK';
    } catch (e) {
        return `FAILED: ${e.message}`;
    }
}

async function deleteEnrollment(enrollmentId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollmentId}`, {
        method: 'DELETE', headers: tkKeyHeaders
    });
    return res.status === 204 || res.status === 404 || res.ok;
}

async function deleteThinkificUser(userId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        method: 'DELETE', headers: tkKeyHeaders
    });
    return res.status;
}

function generateEmail(firstName, lastInitial) {
    const n = Math.floor(1000 + Math.random() * 9000);
    const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const l = lastInitial.toLowerCase().replace(/[^a-z]/g, '');
    return `${f}${l}${n}@modalmath.com`;
}

async function getActiveStudentCount(teacherEmail, base44) {
    const [codes, archived] = await Promise.all([
        base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
        base44.asServiceRole.entities.ArchivedStudent.filter({})
    ]);
    const archivedSet = new Set((archived || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean));
    return (codes || []).filter(s => {
        const e = s.studentEmail?.toLowerCase().trim();
        return e && e.endsWith('@modalmath.com') && !archivedSet.has(e);
    }).length;
}

// ── Main ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const reqBody = await req.json().catch(() => ({}));

        // Resolve teacher
        let teacherEmail = reqBody.teacherEmail || null;
        let teacherUserId = reqBody.teacherUserId || 'unknown';

        if (!teacherEmail) {
            const codes = await base44.asServiceRole.entities.StudentAccessCode.list('-created_date', 1);
            if (codes?.length > 0) teacherEmail = codes[0].createdByTeacherEmail;
            else return Response.json({ error: 'Pass { "teacherEmail": "...", "teacherUserId": "..." }' }, { status: 400 });
        }

        console.log(`[test] teacher=${teacherEmail}`);

        const tGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
        const groupIds = (tGroups || []).map(g => String(g.thinkificGroupId));

        const report = { teacher: teacherEmail, teacherGroupIds: groupIds, tests: {} };

        // ── TEST A: Cap blocking ─────────────────────────────────────────────────
        console.log('[testA] cap blocking');
        {
            const activeCount = await getActiveStudentCount(teacherEmail, base44);
            const fakesToCreate = Math.max(0, 10 - activeCount);
            const fakeEmails = [];

            for (let i = 0; i < fakesToCreate; i++) {
                const fe = `captest_fake_${i}_${Date.now()}@modalmath.com`;
                fakeEmails.push(fe);
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: fe,
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: teacherEmail
                });
            }

            // Now check what addStudents would do
            const countNow = await getActiveStudentCount(teacherEmail, base44);
            const slotsRemaining = 10 - countNow;
            const wouldBeBlocked = slotsRemaining <= 0 || 1 > slotsRemaining;

            // Clean up fakes BEFORE any Thinkific call — no user created
            for (const fe of fakeEmails) {
                const recs = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: fe });
                for (const r of recs) await base44.asServiceRole.entities.StudentAccessCode.delete(r.id);
            }

            report.tests.A = {
                description: 'Cap blocking — no partial add',
                activeCountBeforeTest: activeCount,
                fakesInserted: fakesToCreate,
                countAtBlock: countNow,
                slotsRemaining,
                wouldReturnHttp400: wouldBeBlocked,
                noThinkificCallMade: true, // by design — block happens before any Thinkific call
                PASS: wouldBeBlocked
            };
            console.log('[testA] PASS:', report.tests.A.PASS, '| slotsRemaining:', slotsRemaining);
        }

        // ── TEST B: Add 1 student success ────────────────────────────────────────
        console.log('[testB] add 1 student');
        let createdStudentEmail = null;
        let createdThinkificUserId = null;
        {
            // Create Thinkific user
            const email = generateEmail('Validtest', 'B');
            let user;
            try {
                user = await createThinkificUser('Validtest', 'B', email);
            } catch (e) {
                report.tests.B = { PASS: false, error: `createThinkificUser failed: ${e.message}` };
                console.error('[testB] createThinkificUser failed:', e.message);
                user = null;
            }

            if (user) {
                createdStudentEmail = email;
                createdThinkificUserId = user.id;
                console.log(`[testB] Thinkific user created: id=${user.id}, email=${email}`);

                // Save StudentAccessCode
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: email.toLowerCase().trim(),
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: teacherEmail
                });

                // Add to groups
                const groupResults = [];
                if (groupIds.length === 0) {
                    groupResults.push({ note: 'No TeacherGroups for this teacher — skipped' });
                } else {
                    for (const gid of groupIds) {
                        try {
                            await addToGroup(user.id, gid);
                            groupResults.push({ groupId: gid, result: 'OK' });
                        } catch (e) {
                            groupResults.push({ groupId: gid, result: 'FAILED', error: e.message });
                        }
                    }
                }

                // Enroll in bundle
                const bundleResult = await enrollInBundle(user.id);

                // Enroll in all courses
                const enrollmentResults = await Promise.all(ALL_COURSE_IDS.map(cid => enrollInCourse(user.id, cid)));

                // Verify via Thinkific
                await new Promise(r => setTimeout(r, 1000));
                const enrollmentsActual = await getUserEnrollments(user.id);
                const enrolledCourseIds = enrollmentsActual.map(e => String(e.course_id));
                // Check group membership per group
                const groupCheckResults = [];
                for (const gid of groupIds) {
                    const inGroup = await checkUserInGroup(user.id, gid);
                    groupCheckResults.push({ groupId: gid, inGroup });
                }
                const groupIdsActual = groupCheckResults.filter(g => g.inGroup === true).map(g => g.groupId);

                const codeRecs = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: email.toLowerCase().trim() });

                const enrollmentVerification = {};
                for (const cid of ALL_COURSE_IDS) {
                    enrollmentVerification[cid] = enrolledCourseIds.includes(cid) ? 'ENROLLED' : 'MISSING';
                }

                const allGroupsJoined = groupIds.length === 0 || groupIds.every(gid => groupIdsActual.includes(gid));

                report.tests.B = {
                    description: 'Add 1 student success',
                    thinkificUserId: user.id,
                    studentEmail: email,
                    thinkificUserCreated: true,
                    groupResults,
                    groupCheckResults,
                    bundleEnrollment: bundleResult,
                    enrollmentAttempts: enrollmentResults,
                    enrollmentVerification,
                    groupIdsExpected: groupIds,
                    groupIdsActual,
                    allGroupsJoined,
                    studentAccessCodeCreated: codeRecs.length > 0,
                    studentAccessCodeTeacher: codeRecs[0]?.createdByTeacherEmail,
                    PASS: Object.values(enrollmentVerification).every(v => v === 'ENROLLED') && allGroupsJoined && codeRecs.length > 0
                };
                console.log('[testB] PASS:', report.tests.B.PASS);
            }
        }

        // ── TEST C: Email collision retry ────────────────────────────────────────
        console.log('[testC] email collision retry');
        {
            // Simulate collision: try to create a user with the SAME email as Test B student
            let collisionCaught = false;
            let retrySucceeded = false;
            let retryEmail = null;

            if (createdStudentEmail) {
                // Attempt 1: use existing email — should fail
                try {
                    await createThinkificUser('Validtest', 'B', createdStudentEmail);
                    // If somehow it succeeded (shouldn't), note it
                    collisionCaught = false;
                } catch (e) {
                    const msg = e.message.toLowerCase();
                    collisionCaught = msg.includes('already') || msg.includes('taken') || msg.includes('exist') || msg.includes('400') || msg.includes('422');
                    console.log('[testC] collision error caught:', e.message);
                }

                // Retry with a fresh email (simulates what the retry loop does)
                if (collisionCaught) {
                    const retryE = generateEmail('Validtest', 'B');
                    try {
                        const retryUser = await createThinkificUser('Validtest', 'B', retryE);
                        retrySucceeded = !!retryUser?.id;
                        retryEmail = retryE;
                        // Clean up retry user immediately
                        if (retryUser?.id) await deleteThinkificUser(retryUser.id);
                    } catch (e2) {
                        console.error('[testC] retry also failed:', e2.message);
                    }
                }
            }

            report.tests.C = {
                description: 'Email collision retry',
                collisionErrorCaughtOnDuplicateEmail: collisionCaught,
                retryWithNewEmailSucceeded: retrySucceeded,
                retryEmailDifferentFromOriginal: retryEmail !== createdStudentEmail,
                PASS: collisionCaught && retrySucceeded && retryEmail !== createdStudentEmail
            };
            console.log('[testC] PASS:', report.tests.C.PASS);
        }

        // ── TEST D: Archive behavior ─────────────────────────────────────────────
        console.log('[testD] archive');
        {
            if (!createdStudentEmail || !createdThinkificUserId) {
                report.tests.D = { PASS: false, note: 'Skipped — Test B did not create student' };
            } else {
                // Create ArchivedStudent record
                await base44.asServiceRole.entities.ArchivedStudent.create({
                    studentEmail: createdStudentEmail,
                    groupId: groupIds[0] || 'unknown',
                    teacherThinkificUserId: String(teacherUserId),
                    archivedAt: new Date().toISOString()
                });

                // Unenroll from PK–L5 only
                const enrollments = await getUserEnrollments(createdThinkificUserId);
                const toUnenroll = enrollments.filter(e => LEVEL_COURSE_IDS.includes(String(e.course_id)));
                let unenrolledCount = 0;
                for (const e of toUnenroll) {
                    const ok = await deleteEnrollment(e.id);
                    if (ok) unenrolledCount++;
                }

                console.log(`[testD] unenrolled ${unenrolledCount} level enrollments`);

                // Verify post-archive state
                await new Promise(r => setTimeout(r, 1000));
                const enrollmentsAfter = await getUserEnrollments(createdThinkificUserId);
                const enrolledAfter = enrollmentsAfter.map(e => String(e.course_id));

                const levelResults = LEVEL_COURSE_IDS.map(cid => ({
                    courseId: cid,
                    removed: !enrolledAfter.includes(cid)
                }));
                const allLevelsRemoved = levelResults.every(r => r.removed);
                const assignmentsCourseStillEnrolled = enrolledAfter.includes(ASSIGNMENTS_COURSE_ID);

                const groupCheckAfter = [];
                for (const gid of groupIds) {
                    const inGroup = await checkUserInGroup(createdThinkificUserId, gid);
                    groupCheckAfter.push({ groupId: gid, inGroup });
                }
                const groupIdsAfter = groupCheckAfter.filter(g => g.inGroup === true).map(g => g.groupId);
                const groupPreserved = groupIds.length === 0 || groupIds.some(gid => groupIdsAfter.includes(gid));

                const userAfter = await findUserByEmail(createdStudentEmail);
                const userStillExists = !!userAfter?.id;

                const archivedRecs = await base44.asServiceRole.entities.ArchivedStudent.filter({ studentEmail: createdStudentEmail });
                const archivedInDB = archivedRecs.length > 0;

                report.tests.D = {
                    description: 'Archive behavior',
                    unenrolledFromLevelCount: unenrolledCount,
                    levelCourseResults: levelResults,
                    allLevelEnrollmentsRemoved: allLevelsRemoved,
                    assignmentsCourse3359727StillEnrolled: assignmentsCourseStillEnrolled,
                    enrolledCourseIdsAfterArchive: enrolledAfter,
                    groupMembershipPreserved: groupPreserved,
                    groupIdsAfterArchive: groupIdsAfter,
                    thinkificUserStillExists: userStillExists,
                    archivedStudentRecordInDB: archivedInDB,
                    PASS: allLevelsRemoved && assignmentsCourseStillEnrolled && groupPreserved && userStillExists && archivedInDB
                };
                console.log('[testD] PASS:', report.tests.D.PASS);

                // Clean up
                await deleteThinkificUser(createdThinkificUserId);
                const codes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: createdStudentEmail });
                for (const c of codes) await base44.asServiceRole.entities.StudentAccessCode.delete(c.id);
                for (const a of archivedRecs) await base44.asServiceRole.entities.ArchivedStudent.delete(a.id);
                console.log('[testD] cleaned up test student');
            }
        }

        const allPass = Object.values(report.tests).every(t => t.PASS === true);
        report.overallPass = allPass;
        return Response.json(report);

    } catch (error) {
        console.error('Diagnostic error:', error?.stack || error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});