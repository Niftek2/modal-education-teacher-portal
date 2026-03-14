import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

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

const COURSE_NAMES = ['Your Classroom', 'PK', 'K', 'L1', 'L2', 'L3', 'L4', 'L5'];

const thinkificHeaders = {
  'X-Auth-API-Key': THINKIFIC_API_TOKEN,
  'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
  'Content-Type': 'application/json',
};

async function findThinkificUser(email) {
  const res = await fetch(
    `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
    { headers: thinkificHeaders }
  );
  const data = await res.json();
  return data.items?.[0] || null;
}

async function createThinkificUser(email) {
  const parts = email.split('@')[0].split('.');
  const firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Teacher';
  const lastName = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : '';

  const res = await fetch('https://api.thinkific.com/api/public/v1/users', {
    method: 'POST',
    headers: thinkificHeaders,
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email,
      send_welcome_email: false, // We send our own branded email
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || data?.errors?.[0]?.message || `Failed to create Thinkific user (${res.status})`);
  }
  return data;
}

async function enrollInCourse(userId, courseId, expiryDate) {
  const body = {
    user_id: Number(userId),
    course_id: Number(courseId),
    activated_at: new Date().toISOString(),
  };
  if (expiryDate) {
    body.expiry_date = expiryDate;
  }

  const res = await fetch('https://api.thinkific.com/api/public/v1/enrollments', {
    method: 'POST',
    headers: thinkificHeaders,
    body: JSON.stringify(body),
  });

  if (res.ok) return true;

  const data = await res.json().catch(() => ({}));
  const errMsg = (data?.message || data?.errors?.[0]?.message || '').toLowerCase();

  // If already enrolled, try to update the expiry_date via PUT
  if (res.status === 422 && (errMsg.includes('already enrolled') || errMsg.includes('already been taken'))) {
    if (expiryDate) {
      // Find the enrollment ID and update it
      const enrollRes = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?query[user_id]=${userId}&query[course_id]=${courseId}`,
        { headers: thinkificHeaders }
      );
      const enrollData = await enrollRes.json();
      const enrollment = enrollData.items?.[0];
      if (enrollment?.id) {
        await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollment.id}`, {
          method: 'PUT',
          headers: thinkificHeaders,
          body: JSON.stringify({ expiry_date: expiryDate }),
        });
      }
    }
    return true;
  }

  console.warn(`[inviteDistrictTeacher] Enrollment failed for courseId=${courseId}:`, errMsg);
  return false;
}

async function sendInviteEmail(accessToken, teacherEmail, districtName, adminName, trialEndDate) {
  const thinkificLoginUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/users/password/new`;
  const trialEndFormatted = trialEndDate
    ? new Date(trialEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const emailBody = [
    `To: ${teacherEmail}`,
    'From: Modal Education <contact@modalmath.com>',
    `Subject: You've Been Invited to Modal Math — Set Up Your Account`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e003a;max-width:600px;margin:0 auto;padding:24px;">`,
    `<img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" alt="Modal Education" style="height:40px;margin-bottom:24px;" />`,
    `<h2 style="color:#1e003a;">You're Invited to Modal Math!</h2>`,
    `<p><strong>${districtName || adminName || 'Your district administrator'}</strong> has given you access to Modal Math for your classroom.</p>`,
    `<p>You've been enrolled in the full Modal Math program — PK through Grade 5 — across all 4 learning modalities (sign language, voice, visuals, and text).</p>`,
    trialEndFormatted ? `<p style="background:#ede0fb;border-radius:8px;padding:12px 16px;"><strong>Trial Access:</strong> Your access is active through <strong>${trialEndFormatted}</strong>.</p>` : '',
    `<p><strong>To get started, set up your password:</strong></p>`,
    `<p><a href="${thinkificLoginUrl}" style="background:#520096;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">Set Your Password →</a></p>`,
    `<p style="color:#666;font-size:14px;">On that page, enter your email address (<strong>${teacherEmail}</strong>) and click "Send me reset password instructions". You'll receive an email to create your password and access the platform.</p>`,
    `<p style="margin-top:32px;color:#666;font-size:13px;">Questions? Email us at <a href="mailto:contact@modalmath.com" style="color:#520096;">contact@modalmath.com</a></p>`,
    `<p style="color:#666;font-size:13px;">— The Modal Education Team</p>`,
    `</body></html>`,
  ].join('\r\n');

  const encoder = new TextEncoder();
  const data = encoder.encode(emailBody);
  let base64 = '';
  for (let i = 0; i < data.length; i += 8192) {
    base64 += String.fromCharCode(...data.subarray(i, i + 8192));
  }
  base64 = btoa(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64 }),
  });

  if (!gmailRes.ok) {
    const err = await gmailRes.text();
    throw new Error(`Gmail send failed: ${err}`);
  }
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

    if (license.status === 'expired' || license.status === 'canceled') {
      return Response.json({ error: 'License is not active' }, { status: 403 });
    }

    const invitedTeachers = license.invitedTeachers || [];
    if (invitedTeachers.includes(normalizedTeacher)) {
      return Response.json({ error: 'This teacher has already been invited' }, { status: 409 });
    }

    if ((license.licensesUsed || 0) >= license.totalLicenses) {
      return Response.json({ error: 'No remaining licenses available' }, { status: 403 });
    }

    // Determine expiry date: trials expire at trialEndDate, paid licenses have no expiry
    const expiryDate = license.status === 'trial' && license.trialEndDate
      ? new Date(license.trialEndDate).toISOString()
      : null;

    // Find or create Thinkific user
    let thinkificUser = await findThinkificUser(normalizedTeacher);
    if (!thinkificUser) {
      console.log(`[inviteDistrictTeacher] Creating new Thinkific user: ${normalizedTeacher}`);
      thinkificUser = await createThinkificUser(normalizedTeacher);
    } else {
      console.log(`[inviteDistrictTeacher] Found existing Thinkific user: ${normalizedTeacher} (id=${thinkificUser.id})`);
    }

    // Enroll in all courses with expiry date
    const enrollmentResults = [];
    for (let i = 0; i < COURSE_IDS.length; i++) {
      const courseId = COURSE_IDS[i];
      const courseName = COURSE_NAMES[i] || courseId;
      const success = await enrollInCourse(thinkificUser.id, courseId, expiryDate);
      enrollmentResults.push({ course: courseName, courseId, success });
      console.log(`[inviteDistrictTeacher] Enrolled ${normalizedTeacher} in ${courseName}: ${success}`);
    }

    // Update license record
    const updatedTeachers = [...invitedTeachers, normalizedTeacher];
    await base44.asServiceRole.entities.DistrictLicense.update(license.id, {
      invitedTeachers: updatedTeachers,
      licensesUsed: (license.licensesUsed || 0) + 1,
    });

    // Send password setup email
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
    await sendInviteEmail(accessToken, normalizedTeacher, license.districtName, license.adminName, expiryDate);

    const failedCourses = enrollmentResults.filter(r => !r.success).map(r => r.course);

    return Response.json({
      success: true,
      licensesUsed: (license.licensesUsed || 0) + 1,
      totalLicenses: license.totalLicenses,
      thinkificUserId: thinkificUser.id,
      enrollmentResults,
      failedCourses,
      expiryDate,
    });

  } catch (error) {
    console.error('[inviteDistrictTeacher] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});