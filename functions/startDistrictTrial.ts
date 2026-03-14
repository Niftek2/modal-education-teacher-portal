import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { adminEmail, adminName, adminTitle, districtName, seats } = await req.json();

    if (!adminEmail || !adminName || !districtName || !seats) {
      return Response.json({ error: 'adminEmail, adminName, districtName, and seats are required' }, { status: 400 });
    }
    if (seats < 5) {
      return Response.json({ error: 'Free trial is only available for 5 or more teacher seats' }, { status: 400 });
    }

    const normalizedEmail = adminEmail.toLowerCase().trim();

    // Check for existing license
    const existing = await base44.asServiceRole.entities.DistrictLicense.filter({ adminEmail: normalizedEmail });
    if (existing.length > 0) {
      return Response.json({ error: 'An account already exists for this email address.' }, { status: 409 });
    }

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    const license = await base44.asServiceRole.entities.DistrictLicense.create({
      adminEmail: normalizedEmail,
      adminName,
      adminTitle: adminTitle || '',
      districtName,
      totalLicenses: Number(seats),
      licensesUsed: 0,
      status: 'trial',
      trialEndDate: trialEndDate.toISOString(),
      invitedTeachers: [],
    });

    // Send confirmation email via Gmail
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
      const emailBody = [
        `To: ${normalizedEmail}`,
        'From: Modal Education <contact@modalmath.com>',
        'Subject: Your 14-Day Free Trial Has Started — Modal Math',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        `<h2>Welcome to Modal Math, ${adminName}!</h2>`,
        `<p>Your 14-day free trial for <strong>${districtName}</strong> has been activated with <strong>${seats} teacher seats</strong>.</p>`,
        `<p>Your trial ends on <strong>${trialEndDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>.</p>`,
        `<p>You can now access your District Admin Dashboard to invite teachers and manage your program.</p>`,
        `<p>If you have any questions, reply to this email or contact us at contact@modalmath.com.</p>`,
        `<p>— The Modal Education Team</p>`,
      ].join('\r\n');

      const encoded = btoa(unescape(encodeURIComponent(emailBody))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
      });
    } catch (emailErr) {
      console.warn('[startDistrictTrial] Email send failed:', emailErr.message);
    }

    return Response.json({ success: true, licenseId: license.id, trialEndDate: trialEndDate.toISOString() });
  } catch (error) {
    console.error('Start district trial error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});