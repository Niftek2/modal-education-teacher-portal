import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");

const COURSE_IDS = [
  Deno.env.get("CLASSROOM_PRODUCT_ID"),
  Deno.env.get("PK_COURSE_ID"),
  Deno.env.get("K_COURSE_ID"),
  Deno.env.get("L1_COURSE_ID"),
  Deno.env.get("L2_COURSE_ID"),
  Deno.env.get("L3_COURSE_ID"),
  Deno.env.get("L4_COURSE_ID"),
  Deno.env.get("L5_COURSE_ID"),
].filter(Boolean);

const thinkificHeaders = {
  'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
  'Content-Type': 'application/json',
};

async function findThinkificUser(email) {
  const res = await fetch(
    `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}&limit=1`,
    { headers: thinkificHeaders }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0] || null;
}

// Expire an enrollment by setting expiry_date to now (Thinkific doesn't support hard delete via REST).
async function expireEnrollment(userId, courseId) {
  const enrollRes = await fetch(
    `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${courseId}`,
    { headers: thinkificHeaders }
  );
  if (!enrollRes.ok) return false;
  const enrollData = await enrollRes.json();
  const enrollment = enrollData.items?.[0];
  if (!enrollment?.id) return false;

  const expireRes = await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`, {
    method: 'PUT',
    headers: thinkificHeaders,
    body: JSON.stringify({ expiry_date: new Date().toISOString() }),
  });
  return expireRes.ok;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { adminEmail, teacherEmail } = await req.json();

    if (!adminEmail || !teacherEmail) {
      return Response.json({ error: 'adminEmail and teacherEmail are required' }, { status: 400 });
    }

    const normalizedAdmin = adminEmail.toLowerCase().trim();
    const normalizedTeacher = teacherEmail.toLowerCase().trim();

    // Load license
    const licenses = await base44.asServiceRole.entities.DistrictLicense.filter({ adminEmail: normalizedAdmin });
    if (licenses.length === 0) {
      return Response.json({ error: 'No license found for this admin' }, { status: 404 });
    }
    const license = licenses[0];

    const invitedTeachers = license.invitedTeachers || [];
    if (!invitedTeachers.includes(normalizedTeacher)) {
      return Response.json({ error: 'Teacher is not on this license' }, { status: 404 });
    }

    // Expire Thinkific enrollments (best-effort)
    const thinkificUser = await findThinkificUser(normalizedTeacher);
    let expiredCount = 0;
    if (thinkificUser?.id) {
      for (const courseId of COURSE_IDS) {
        const ok = await expireEnrollment(thinkificUser.id, courseId);
        if (ok) expiredCount++;
      }
      console.log(`[removeDistrictTeacher] Expired ${expiredCount}/${COURSE_IDS.length} enrollments for ${normalizedTeacher}`);
    } else {
      console.log(`[removeDistrictTeacher] No Thinkific user found for ${normalizedTeacher} — only updating license record`);
    }

    // Free the seat
    const updatedTeachers = invitedTeachers.filter(e => e !== normalizedTeacher);
    await base44.asServiceRole.entities.DistrictLicense.update(license.id, {
      invitedTeachers: updatedTeachers,
      licensesUsed: Math.max(0, (license.licensesUsed || 0) - 1),
    });

    return Response.json({
      success: true,
      licensesUsed: Math.max(0, (license.licensesUsed || 0) - 1),
      totalLicenses: license.totalLicenses,
      expiredEnrollments: expiredCount,
    });

  } catch (error) {
    console.error('[removeDistrictTeacher] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});