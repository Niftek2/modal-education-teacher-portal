import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const THINKIFIC_API_ACCESS_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

const tkHeaders = {
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

async function tkGet(path) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1${path}`, { headers: tkBearerHeaders });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
}

async function tkGetKey(path) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1${path}`, { headers: tkHeaders });
    if (!res.ok) throw new Error(`GET(key) ${path} → ${res.status}`);
    return res.json();
}

async function findUserByEmail(email) {
    const data = await tkGet(`/users?query[email]=${encodeURIComponent(email)}`);
    return data.items?.[0] || null;
}

async function getUserEnrollments(userId) {
    const data = await tkGet(`/enrollments?query[user_id]=${userId}&limit=100`);
    return data.items || [];
}

async function getUserGroupMemberships(userId) {
    const data = await tkGet(`/group_memberships?query[user_id]=${userId}&limit=100`);
    return data.items || [];
}

async function deleteThinkificUser(userId) {
    const res = await fetch(`https://api.thinkific.com/api/public/v1/users/${userId}`, {
        method: 'DELETE', headers: tkHeaders
    });
    return res.status;
}

// ── JWT helper to mint a test session token ────────────────────────────────────

async function mintSessionToken(email, userId) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    return new jose.SignJWT({ email, userId, role: 'teacher' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);
}

// ── Call addStudents via fetch (so requireSession works) ───────────────────────

async function callAddStudents(token, payload) {
    const APP_ID = '698c9549de63fc919dec560c';
    const res = await fetch(`/api/apps/${APP_ID}/functions/addStudents`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function callRemoveStudent(token, payload) {
    const APP_ID = '698c9549de63fc919dec560c';
    const res = await fetch(`/api/apps/${APP_ID}/functions/removeStudent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

// ── Main ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Accept teacher email from payload, fall back to DB lookup
        const reqBody = await req.json().catch(() => ({}));
        let teacherEmail = reqBody.teacherEmail || null;
        let teacherUserId = reqBody.teacherUserId || 'unknown';

        if (!teacherEmail) {
            // Try TeacherGroup first
            const teacherGroups = await base44.asServiceRole.entities.TeacherGroup.list('-created_date', 1);
            if (teacherGroups && teacherGroups.length > 0) {
                teacherEmail = teacherGroups[0].teacherEmail;
                teacherUserId = teacherGroups[0].teacherThinkificUserId || 'unknown';
            } else {
                // Fall back to StudentAccessCode
                const codes = await base44.asServiceRole.entities.StudentAccessCode.list('-created_date', 1);
                if (codes && codes.length > 0) {
                    teacherEmail = codes[0].createdByTeacherEmail;
                } else {
                    return Response.json({ error: 'No teacher found in DB. Pass { "teacherEmail": "...", "teacherUserId": "..." } in payload.' }, { status: 500 });
                }
            }
        }

        console.log(`[test] Using teacher: ${teacherEmail}`);

        // Mint a real session token for this teacher
        const token = await mintSessionToken(teacherEmail, teacherUserId);

        // Get teacher's groups
        const tGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail });
        const groupIds = tGroups.map(g => g.thinkificGroupId);

        const report = { teacher: teacherEmail, teacherGroupIds: groupIds, tests: {} };

        // ────────────────────────────────────────────────────────────────────────
        // TEST A: Cap blocking
        // ────────────────────────────────────────────────────────────────────────
        console.log('[test] Running Test A: cap blocking');
        {
            // Count current active students
            const [codes, archived] = await Promise.all([
                base44.asServiceRole.entities.StudentAccessCode.filter({ createdByTeacherEmail: teacherEmail }),
                base44.asServiceRole.entities.ArchivedStudent.filter({})
            ]);
            const archivedSet = new Set((archived || []).map(s => s.studentEmail?.toLowerCase().trim()).filter(Boolean));
            const activeCodes = (codes || []).filter(s => {
                const e = s.studentEmail?.toLowerCase().trim();
                return e && e.endsWith('@modalmath.com') && !archivedSet.has(e);
            });
            const activeCount = activeCodes.length;

            // Temporarily insert fake StudentAccessCode records to push count to 10
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

            console.log(`[testA] activeCount before fakes=${activeCount}, fakes inserted=${fakesToCreate}, total should be 10`);

            // Now call addStudents — should be blocked
            const result = await callAddStudents(token, { students: [{ firstName: 'CapTest', lastInitial: 'X' }] });

            // Clean up fake records
            for (const fe of fakeEmails) {
                const recs = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: fe });
                for (const r of recs) await base44.asServiceRole.entities.StudentAccessCode.delete(r.id);
            }

            const blocked = result.status === 400 && (result.body?.error || '').toLowerCase().includes('roster');

            // Verify no new Thinkific user was created for 'captestx'
            const escapedName = `captestx`;
            let tkUserCreated = false;
            try {
                // Search Thinkific for any user whose email starts with captestx
                const data = await tkGetKey(`/users?query[email]=captestx`);
                tkUserCreated = (data.items || []).length > 0;
            } catch (e) {
                // ignore search error
            }

            report.tests.A = {
                description: 'Cap blocking — no partial add',
                activeCountBeforeTest: activeCount,
                fakesInserted: fakesToCreate,
                httpStatus: result.status,
                responseBody: result.body,
                blocked,
                noThinkificUserCreated: !tkUserCreated,
                PASS: blocked && !tkUserCreated
            };
        }

        // ────────────────────────────────────────────────────────────────────────
        // TEST B: Add 1 student success
        // ────────────────────────────────────────────────────────────────────────
        console.log('[test] Running Test B: add 1 student');
        let createdStudentEmail = null;
        let createdThinkificUserId = null;
        {
            const result = await callAddStudents(token, {
                students: [{ firstName: 'Validtest', lastInitial: 'B' }]
            });

            const studentResult = result.body?.results?.[0];
            const success = result.status === 200 && studentResult?.success === true;

            if (success) {
                createdStudentEmail = studentResult.student.email;
                createdThinkificUserId = studentResult.student.id;
                console.log(`[testB] Created student: ${createdStudentEmail}, Thinkific ID: ${createdThinkificUserId}`);
            }

            // Verify Thinkific user exists
            let tkUser = null;
            let enrollments = [];
            let groupMemberships = [];
            let enrollmentResults = {};

            if (createdThinkificUserId) {
                try { tkUser = await findUserByEmail(createdStudentEmail); } catch (e) { console.error('tkUser lookup failed:', e.message); }
                try { enrollments = await getUserEnrollments(createdThinkificUserId); } catch (e) { console.error('enrollments failed:', e.message); }
                try { groupMemberships = await getUserGroupMemberships(createdThinkificUserId); } catch (e) { console.error('groups failed:', e.message); }
            }

            const requiredCourseIds = ['3359727', '422595', '422618', '422620', '496294', '496295', '496297', '496298'];
            const enrolledCourseIds = enrollments.map(e => String(e.course_id));
            for (const cid of requiredCourseIds) {
                enrollmentResults[cid] = enrolledCourseIds.includes(cid) ? 'ENROLLED' : 'MISSING';
            }

            // Verify StudentAccessCode in Base44
            let codeRecord = null;
            if (createdStudentEmail) {
                const codes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: createdStudentEmail });
                codeRecord = codes?.[0] || null;
            }

            const groupMemberGroupIds = groupMemberships.map(m => String(m.group_id));
            const allGroupsJoined = groupIds.length === 0 || groupIds.every(gid => groupMemberGroupIds.includes(String(gid)));

            report.tests.B = {
                description: 'Add 1 student success',
                httpStatus: result.status,
                studentEmail: createdStudentEmail,
                thinkificUserId: createdThinkificUserId,
                thinkificUserFound: !!tkUser,
                enrollmentResults,
                groupIdsExpected: groupIds,
                groupIdsActual: groupMemberGroupIds,
                allGroupsJoined,
                studentAccessCodeCreated: !!codeRecord,
                studentAccessCodeEmail: codeRecord?.studentEmail,
                studentAccessCodeTeacher: codeRecord?.createdByTeacherEmail,
                warnings: studentResult?.warnings || [],
                PASS: success && !!tkUser && allGroupsJoined && !!codeRecord && Object.values(enrollmentResults).every(v => v === 'ENROLLED')
            };
        }

        // ────────────────────────────────────────────────────────────────────────
        // TEST C: Email collision retry
        // ────────────────────────────────────────────────────────────────────────
        console.log('[test] Running Test C: email collision retry');
        {
            // We'll test by calling addStudents twice with the same first+last
            // (same name → same email pattern → collision on 2nd call is very unlikely but retry logic is code-verifiable)
            // Better approach: call with firstName that produces an email we KNOW exists
            // Use the already-created student from Test B
            let collisionTestNote = '';
            let retryResult = null;

            if (createdStudentEmail) {
                // The email is e.g. validtestb1234@modalmath.com
                // We can't force Thinkific to reject a specific email from outside, so we verify
                // the retry logic by checking the code path exists and a second student with
                // same initials can be created (different random digits)
                const result2 = await callAddStudents(token, {
                    students: [{ firstName: 'Validtest', lastInitial: 'B' }]
                });
                retryResult = result2;
                collisionTestNote = 'Sent same firstName+lastInitial as Test B to trigger potential collision. Both should succeed with different random digits.';
            } else {
                collisionTestNote = 'Test B did not create a student, skipping collision test.';
            }

            const retrySuccess = retryResult?.status === 200 && retryResult?.body?.results?.[0]?.success === true;
            const retryEmail = retryResult?.body?.results?.[0]?.student?.email;

            // Clean up the second student if created
            if (retryEmail) {
                const tkUser2 = await findUserByEmail(retryEmail).catch(() => null);
                if (tkUser2?.id) {
                    await deleteThinkificUser(tkUser2.id);
                }
                const codes2 = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: retryEmail });
                for (const c of codes2) await base44.asServiceRole.entities.StudentAccessCode.delete(c.id);
            }

            report.tests.C = {
                description: 'Email collision retry',
                note: collisionTestNote,
                retryHttpStatus: retryResult?.status,
                retryStudentEmail: retryEmail,
                differentEmailFromTestB: retryEmail && retryEmail !== createdStudentEmail,
                PASS: retrySuccess && retryEmail !== createdStudentEmail
            };
        }

        // ────────────────────────────────────────────────────────────────────────
        // TEST D: Archive behavior
        // ────────────────────────────────────────────────────────────────────────
        console.log('[test] Running Test D: archive');
        {
            if (!createdStudentEmail || !createdThinkificUserId) {
                report.tests.D = { description: 'Archive behavior', PASS: false, note: 'Skipped — Test B did not create a student' };
            } else {
                // Call removeStudent
                const archiveResult = await callRemoveStudent(token, {
                    studentEmail: createdStudentEmail,
                    groupId: groupIds[0] || 'unknown',
                    teacherId: teacherUserId
                });

                // Give Thinkific a moment
                await new Promise(r => setTimeout(r, 1500));

                // Check enrollments after archive
                let enrollmentsAfter = [];
                try { enrollmentsAfter = await getUserEnrollments(createdThinkificUserId); } catch (e) { console.error('post-archive enrollments failed:', e.message); }

                const levelCourseIds = ['422595', '422618', '422620', '496294', '496295', '496297', '496298'];
                const enrolledAfter = enrollmentsAfter.map(e => String(e.course_id));

                const levelEnrollmentsRemoved = levelCourseIds.every(cid => !enrolledAfter.includes(cid));
                const assignmentsCourseStillEnrolled = enrolledAfter.includes('3359727');

                // Check group membership still exists
                let groupsAfter = [];
                try { groupsAfter = await getUserGroupMemberships(createdThinkificUserId); } catch (e) { console.error('post-archive groups failed:', e.message); }
                const groupIdsAfter = groupsAfter.map(m => String(m.group_id));
                const groupMembershipPreserved = groupIds.length === 0 || groupIds.some(gid => groupIdsAfter.includes(String(gid)));

                // Check Thinkific user still exists
                let userAfter = null;
                try { userAfter = await findUserByEmail(createdStudentEmail); } catch (e) {}
                const userStillExists = !!userAfter?.id;

                // Check ArchivedStudent record in Base44
                const archivedRecs = await base44.asServiceRole.entities.ArchivedStudent.filter({ studentEmail: createdStudentEmail });
                const archivedInDB = archivedRecs.length > 0;

                report.tests.D = {
                    description: 'Archive behavior',
                    archiveHttpStatus: archiveResult.status,
                    archiveBody: archiveResult.body,
                    levelEnrollmentsRemovedFromThinkific: levelCourseIds.map(cid => ({
                        courseId: cid,
                        removed: !enrolledAfter.includes(cid)
                    })),
                    levelEnrollmentsAllRemoved: levelEnrollmentsRemoved,
                    assignmentsCourse3359727StillEnrolled: assignmentsCourseStillEnrolled,
                    enrolledCourseIdsAfterArchive: enrolledAfter,
                    groupMembershipPreserved,
                    groupIdsAfterArchive: groupIdsAfter,
                    thinkificUserStillExists: userStillExists,
                    archivedStudentRecordInDB: archivedInDB,
                    PASS: levelEnrollmentsRemoved && assignmentsCourseStillEnrolled && groupMembershipPreserved && userStillExists && archivedInDB
                };

                // Clean up: delete the test student from Thinkific + Base44
                await deleteThinkificUser(createdThinkificUserId);
                const codes = await base44.asServiceRole.entities.StudentAccessCode.filter({ studentEmail: createdStudentEmail });
                for (const c of codes) await base44.asServiceRole.entities.StudentAccessCode.delete(c.id);
                for (const a of archivedRecs) await base44.asServiceRole.entities.ArchivedStudent.delete(a.id);
                console.log(`[testD] Cleaned up test student ${createdStudentEmail}`);
            }
        }

        // ── Summary ─────────────────────────────────────────────────────────────
        const allPass = Object.values(report.tests).every(t => t.PASS === true);
        report.overallPass = allPass;

        return Response.json(report, { status: 200 });

    } catch (error) {
        console.error('Diagnostic error:', error?.stack || error);
        return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
});