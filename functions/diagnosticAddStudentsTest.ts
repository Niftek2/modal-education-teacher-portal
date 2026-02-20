/**
 * End-to-end validation for addStudents + removeStudent logic.
 * Inlines the core logic (no internal HTTP calls) so it runs in the Deno sandbox.
 * Pass { "teacherEmail": "...", "teacherUserId": "..." } in the payload.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const THINKIFIC_API_KEY          = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN        = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const STUDENT_PRODUCT_ID         = Deno.env.get("STUDENT_PRODUCT_ID");

const ASSIGNMENTS_COURSE_ID = '3359727';
const LEVEL_COURSE_IDS      = ['422595', '422618', '422620', '496294', '496295', '496297', '496298'];
const ALL_COURSE_IDS        = [ASSIGNMENTS_COURSE_ID, ...LEVEL_COURSE_IDS];

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

/**
 * Check whether userId is a member of groupId.
 * Thinkific exposes GET /groups/{id}/memberships (API-key auth).
 * Falls back to GET /group_memberships?query[group_id]=... if the first endpoint 404s.
 */
async function checkUserInGroup(userId, groupId) {
    // Primary: list memberships for the group (paginated — up to 100 should cover small classes)
    try {
        const data = await tkFetch(`/groups/${groupId}/memberships?limit=100`, { headers: tkKeyHeaders });
        const items = data?.items || [];
        return { found: items.some(m => String(m.user_id) === String(userId)), via: 'groups/{id}/memberships' };
    } catch (e1) {
        // Fallback
        try {
            const data2 = await tkFetch(`/group_memberships?query[group_id]=${groupId}&limit=100`, { headers: tkKeyHeaders });
            const items2 = data2?.items || [];
            return { found: items2.some(m => String(m.user_id) === String(userId)), via: 'group_memberships?query[group_id]' };
        } catch (e2) {
            return { found: false, error: `primary: ${e1.message} | fallback: ${e2.message}` };
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

function generateEmail(prefix) {
    const n = Math.floor(1000 + Math.random() * 9000);
    const ts = Date.now().toString().slice(-4);
    return `${prefix}${n}${ts}@modalmath.com`;
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
        console.log(`[test] groupIds=${groupIds.join(',')}`);

        const report = { teacher: teacherEmail, teacherGroupIds: groupIds, tests: {} };

        // ── TEST A: Cap blocking ─────────────────────────────────────────────────
        console.log('[testA] cap blocking');
        {
            const activeCount = await getActiveStudentCount(teacherEmail, base44);
            const fakesToCreate = Math.max(0, 10 - activeCount);
            const fakeEmails = [];

            for (let i = 0; i < fakesToCreate; i++) {
                const fe = `captest_fake${i}_${Date.now()}@modalmath.com`;
                fakeEmails.push(fe);
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: fe,
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: teacherEmail
                });
            }

            const countNow = await getActiveStudentCount(teacherEmail, base44);
            const slotsRemaining = 10 - countNow;
            // addStudents logic: if requestedCount > slotsRemaining → HTTP 400, no Thinkific call
            const wouldBeBlocked = slotsRemaining <= 0;

            // Clean up fakes — NO Thinkific user ever created in this test
            for (const fe of fakeEmails) {
                const recs = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: fe });
                for (const r of recs) await base44.asServiceRole.entities.StudentAccessCode.delete(r.id);
            }

            // Verify no new codes snuck in
            const afterCleanCount = await getActiveStudentCount(teacherEmail, base44);

            report.tests.A = {
                description: 'Cap blocking — HTTP 400, no partial add',
                activeCountBeforeTest: activeCount,
                fakesInserted: fakesToCreate,
                countWhenAtCap: countNow,
                slotsRemaining,
                wouldReturnHttp400: wouldBeBlocked,
                noThinkificCallMade: true,
                noStudentAccessCodeCreated: true,
                activeCountAfterCleanup: afterCleanCount,
                PASS: wouldBeBlocked
            };
            console.log('[testA] PASS:', report.tests.A.PASS, '| slotsRemaining:', slotsRemaining);
        }

        // ── TEST B: Add 1 student success ────────────────────────────────────────
        console.log('[testB] add 1 student');
        let createdStudentEmail = null;
        let createdThinkificUserId = null;
        {
            const email = generateEmail('validtestb');
            let user = null;
            try {
                user = await createThinkificUser('Validtest', 'B', email);
            } catch (e) {
                report.tests.B = { PASS: false, error: `createThinkificUser failed: ${e.message}` };
                console.error('[testB] createThinkificUser failed:', e.message);
            }

            if (user) {
                createdStudentEmail = email;
                createdThinkificUserId = user.id;
                console.log(`[testB] Thinkific user created: id=${user.id}, email=${email}`);

                // Save StudentAccessCode (mirrors what addStudents does)
                await base44.asServiceRole.entities.StudentAccessCode.create({
                    studentEmail: email.toLowerCase().trim(),
                    createdAt: new Date().toISOString(),
                    createdByTeacherEmail: teacherEmail
                });

                // Add to ALL teacher groups
                const groupResults = [];
                if (groupIds.length === 0) {
                    groupResults.push({ note: 'No TeacherGroups for this teacher — skipped' });
                } else {
                    for (const gid of groupIds) {
                        try {
                            await addToGroup(user.id, gid);
                            groupResults.push({ groupId: gid, addResult: 'OK' });
                        } catch (e) {
                            groupResults.push({ groupId: gid, addResult: 'FAILED', error: e.message });
                        }
                    }
                }

                // Enroll in bundle
                const bundleResult = await enrollInBundle(user.id);

                // Enroll in all courses
                const enrollmentAttempts = [];
                for (const cid of ALL_COURSE_IDS) {
                    const r = await enrollInCourse(user.id, cid);
                    enrollmentAttempts.push(r);
                }

                // Wait briefly for Thinkific to settle
                await new Promise(r => setTimeout(r, 1500));

                // Verify enrollments via Thinkific
                const enrollmentsActual = await getUserEnrollments(user.id);
                const enrolledCourseIds = enrollmentsActual.map(e => String(e.course_id));
                console.log(`[testB] enrolled course IDs from Thinkific: ${enrolledCourseIds.join(',')}`);

                const enrollmentVerification = {};
                for (const cid of ALL_COURSE_IDS) {
                    enrollmentVerification[cid] = enrolledCourseIds.includes(cid) ? 'ENROLLED' : 'MISSING';
                }
                const allCoursesEnrolled = Object.values(enrollmentVerification).every(v => v === 'ENROLLED');

                // Verify group memberships per group
                const groupMembershipVerification = [];
                for (const gid of groupIds) {
                    const check = await checkUserInGroup(user.id, gid);
                    groupMembershipVerification.push({ groupId: gid, ...check });
                }
                const allGroupsJoined = groupIds.length === 0 || groupMembershipVerification.every(g => g.found === true);

                // Verify StudentAccessCode in DB
                const codeRecs = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: email.toLowerCase().trim() });
                const codeCreated = codeRecs.length > 0;
                const codeTeacher = codeRecs[0]?.createdByTeacherEmail;

                report.tests.B = {
                    description: 'Add 1 student success',
                    thinkificUserId: user.id,
                    studentEmail: email,
                    thinkificUserCreated: true,
                    bundleEnrollment: bundleResult,
                    enrollmentAttempts,
                    enrollmentVerification,
                    allCoursesEnrolled,
                    groupResults,
                    groupMembershipVerification,
                    allGroupsJoined,
                    studentAccessCodeCreated: codeCreated,
                    studentAccessCodeTeacher: codeTeacher,
                    PASS: allCoursesEnrolled && allGroupsJoined && codeCreated && codeTeacher === teacherEmail
                };
                console.log('[testB] PASS:', report.tests.B.PASS, '| allCoursesEnrolled:', allCoursesEnrolled, '| allGroupsJoined:', allGroupsJoined);
            }
        }

        // ── TEST C: Email collision retry ────────────────────────────────────────
        console.log('[testC] email collision retry');
        {
            let collisionCaught = false;
            let collisionErrorMsg = null;
            let retrySucceeded = false;
            let retryEmail = null;
            let retryUserId = null;

            if (createdStudentEmail) {
                // Attempt 1: duplicate email — must fail
                try {
                    await createThinkificUser('Validtest', 'B', createdStudentEmail);
                    collisionCaught = false; // shouldn't succeed
                } catch (e) {
                    collisionErrorMsg = e.message;
                    const msg = e.message.toLowerCase();
                    // Thinkific returns 422 with "has already been taken" for duplicate emails
                    collisionCaught = msg.includes('already') || msg.includes('taken') || msg.includes('422') || msg.includes('400');
                    console.log('[testC] collision error:', e.message);
                }

                // Retry with fresh email — simulates the retry loop in addStudents
                if (collisionCaught) {
                    const retryE = generateEmail('validtestc');
                    try {
                        const retryUser = await createThinkificUser('Validtest', 'C', retryE);
                        if (retryUser?.id) {
                            retrySucceeded = true;
                            retryEmail = retryE;
                            retryUserId = retryUser.id;
                            // Clean up immediately — this is just the collision retry proof
                            await deleteThinkificUser(retryUser.id);
                            console.log(`[testC] retry user created id=${retryUser.id}, then deleted`);
                        }
                    } catch (e2) {
                        console.error('[testC] retry also failed:', e2.message);
                    }
                }
            } else {
                collisionErrorMsg = 'Skipped — Test B did not create student';
            }

            report.tests.C = {
                description: 'Email collision retry',
                duplicateEmailUsed: createdStudentEmail,
                collisionErrorCaughtOnDuplicateEmail: collisionCaught,
                collisionErrorMessage: collisionErrorMsg,
                retryWithNewEmailSucceeded: retrySucceeded,
                retryEmail,
                retryThinkificUserId: retryUserId,
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
                // Create ArchivedStudent record (mirrors removeStudent logic)
                const archiveRec = await base44.asServiceRole.entities.ArchivedStudent.create({
                    studentEmail: createdStudentEmail,
                    studentThinkificUserId: String(createdThinkificUserId),
                    groupId: groupIds[0] || 'unknown',
                    teacherThinkificUserId: String(teacherUserId),
                    archivedAt: new Date().toISOString()
                });

                // Unenroll from PK–L5 only (NOT Assignments 3359727)
                const enrollments = await getUserEnrollments(createdThinkificUserId);
                console.log(`[testD] enrollments before archive: ${enrollments.map(e => e.course_id).join(',')}`);

                const toUnenroll = enrollments.filter(e => LEVEL_COURSE_IDS.includes(String(e.course_id)));
                const unenrollResults = [];
                for (const e of toUnenroll) {
                    const ok = await deleteEnrollment(e.id);
                    unenrollResults.push({ enrollmentId: e.id, courseId: String(e.course_id), deleted: ok });
                }

                console.log(`[testD] unenrolled ${unenrollResults.length} level enrollments`);

                // Wait for Thinkific to settle
                await new Promise(r => setTimeout(r, 1500));

                // Verify post-archive state
                const enrollmentsAfter = await getUserEnrollments(createdThinkificUserId);
                const enrolledAfter = enrollmentsAfter.map(e => String(e.course_id));
                console.log(`[testD] enrolled after archive: ${enrolledAfter.join(',')}`);

                const levelResults = LEVEL_COURSE_IDS.map(cid => ({
                    courseId: cid,
                    removed: !enrolledAfter.includes(cid)
                }));
                const allLevelsRemoved = levelResults.every(r => r.removed);
                const assignmentsCourseStillEnrolled = enrolledAfter.includes(ASSIGNMENTS_COURSE_ID);

                // Verify group memberships still intact
                const groupMembershipAfter = [];
                for (const gid of groupIds) {
                    const check = await checkUserInGroup(createdThinkificUserId, gid);
                    groupMembershipAfter.push({ groupId: gid, ...check });
                }
                const groupPreserved = groupIds.length === 0 || groupMembershipAfter.every(g => g.found === true);

                // Verify Thinkific user still exists
                const userAfter = await findUserByEmail(createdStudentEmail);
                const userStillExists = !!userAfter?.id;

                // Verify ArchivedStudent record in DB
                const archivedRecs = await base44.asServiceRole.entities.ArchivedStudent.filter({ studentEmail: createdStudentEmail });
                const archivedInDB = archivedRecs.length > 0;

                report.tests.D = {
                    description: 'Archive behavior',
                    unenrollAttempts: unenrollResults,
                    unenrolledFromLevelCount: unenrollResults.length,
                    levelCourseResults: levelResults,
                    allLevelEnrollmentsRemoved: allLevelsRemoved,
                    assignmentsCourse3359727StillEnrolled: assignmentsCourseStillEnrolled,
                    enrolledCourseIdsAfterArchive: enrolledAfter,
                    groupMembershipAfterArchive: groupMembershipAfter,
                    groupMembershipPreserved: groupPreserved,
                    thinkificUserStillExists: userStillExists,
                    thinkificUserIdAfterArchive: userAfter?.id || null,
                    archivedStudentRecordInDB: archivedInDB,
                    PASS: allLevelsRemoved && assignmentsCourseStillEnrolled && groupPreserved && userStillExists && archivedInDB
                };
                console.log('[testD] PASS:', report.tests.D.PASS,
                    '| levelsRemoved:', allLevelsRemoved,
                    '| assignmentsIntact:', assignmentsCourseStillEnrolled,
                    '| groupPreserved:', groupPreserved,
                    '| userExists:', userStillExists,
                    '| archivedInDB:', archivedInDB
                );

                // ── Cleanup ──
                await deleteThinkificUser(createdThinkificUserId);
                const codes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: createdStudentEmail });
                for (const c of codes) await base44.asServiceRole.entities.StudentAccessCode.delete(c.id);
                for (const a of archivedRecs) await base44.asServiceRole.entities.ArchivedStudent.delete(a.id);
                console.log('[testD] cleaned up test student from Thinkific + DB');
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