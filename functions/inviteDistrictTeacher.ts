import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { adminEmail, teacherEmail } = await req.json();

    if (!adminEmail || !teacherEmail) {
      return Response.json({ error: 'adminEmail and teacherEmail are required' }, { status: 400 });
    }

    const normalizedAdmin = adminEmail.toLowerCase().trim();
    const normalizedTeacher = teacherEmail.toLowerCase().trim();

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

    if (license.licensesUsed >= license.totalLicenses) {
      return Response.json({ error: 'No remaining licenses available' }, { status: 403 });
    }

    // Add teacher to invited list and increment counter
    const updatedTeachers = [...invitedTeachers, normalizedTeacher];
    await base44.asServiceRole.entities.DistrictLicense.update(license.id, {
      invitedTeachers: updatedTeachers,
      licensesUsed: (license.licensesUsed || 0) + 1,
    });

    // Send invite email via Gmail
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
      const signupUrl = 'https://www.modalmath.com/teacher';
      const emailBody = [
        `To: ${normalizedTeacher}`,
        'From: Modal Education <contact@modalmath.com>',
        `Subject: You've Been Invited to Modal Math by ${license.districtName || license.adminName || normalizedAdmin}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        `<h2>You're Invited to Modal Math!</h2>`,
        `<p>${license.districtName || 'Your district'} has purchased access to Modal Math for your classroom.</p>`,
        `<p>Click the link below to create your teacher account:</p>`,
        `<p><a href="${signupUrl}" style="background:#520096;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Create Your Account</a></p>`,
        `<p>Once your account is set up, you'll have full access to the Modal Math teacher portal and student dashboard.</p>`,
        `<p>Questions? Contact us at contact@modalmath.com</p>`,
        `<p>— The Modal Education Team</p>`,
      ].join('\r\n');

      const encoded = btoa(unescape(encodeURIComponent(emailBody))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
      });
    } catch (emailErr) {
      console.warn('[inviteDistrictTeacher] Email send failed:', emailErr.message);
    }

    return Response.json({ success: true, licensesUsed: (license.licensesUsed || 0) + 1, totalLicenses: license.totalLicenses });
  } catch (error) {
    console.error('Invite district teacher error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});