import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

function encodeEmailToBase64Url(emailString) {
    const bytes = new TextEncoder().encode(emailString);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { adminEmail, adminName, adminTitle, districtName, seats } = await req.json();

    if (!adminEmail || !adminName || !districtName || !seats) {
      return Response.json({ error: 'adminEmail, adminName, districtName, and seats are required' }, { status: 400 });
    }
    if (Number(seats) !== 5) {
      return Response.json({ error: 'Free trial is limited to 5 teacher seats.' }, { status: 400 });
    }

    const normalizedEmail = adminEmail.toLowerCase().trim();

    // Check for existing license
    const existing = await base44.asServiceRole.entities.DistrictLicense.filter({ adminEmail: normalizedEmail });
    if (existing.length > 0) {
      return Response.json({ error: 'An account already exists for this email address.' }, { status: 409 });
    }

    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    // Create Thinkific account for the district admin
    try {
      const parts = adminName.trim().split(' ');
      const firstName = parts[0] || 'Admin';
      const lastName = parts.slice(1).join(' ') || 'Admin';
      const createRes = await fetch('https://api.thinkific.com/api/public/v1/users', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('THINKIFIC_API_ACCESS_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, email: normalizedEmail, send_welcome_email: false }),
      });
      if (!createRes.ok) {
        const d = await createRes.json();
        // 422 = already exists, that's fine
        if (createRes.status !== 422) console.warn('[startDistrictTrial] Thinkific user creation failed:', d?.message);
      } else {
        console.log(`[startDistrictTrial] ✓ Thinkific account created for ${normalizedEmail}`);
      }
    } catch (thinkErr) {
      console.warn('[startDistrictTrial] Thinkific setup failed:', thinkErr.message);
    }

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

    // Send admin notification email
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
      const adminNotifyBody = [
        `To: contact@modalmath.com`,
        `From: Modal Education <contact@modalmath.com>`,
        `Subject: 🆕 New District Trial Started — ${districtName}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<h2>New District Free Trial</h2>`,
        `<table style="border-collapse:collapse;font-family:Arial,sans-serif;">`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Name:</td><td style="padding:6px 12px;">${adminName}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Title:</td><td style="padding:6px 12px;">${adminTitle || '—'}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Email:</td><td style="padding:6px 12px;">${normalizedEmail}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">District:</td><td style="padding:6px 12px;">${districtName}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Seats:</td><td style="padding:6px 12px;">${seats}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Trial Ends:</td><td style="padding:6px 12px;">${trialEndDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>`,
        `</table>`,
      ].join('\r\n');
      const encodedNotify = encodeEmailToBase64Url(adminNotifyBody);
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encodedNotify }),
      });
    } catch (notifyErr) {
      console.warn('[startDistrictTrial] Admin notification failed:', notifyErr.message);
    }

    // Send confirmation email via Gmail
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
      const dashboardUrl = `https://modal-math.base44.app/DistrictAdminDashboard?email=${encodeURIComponent(normalizedEmail)}`;
      const thinkificLoginUrl = `https://${Deno.env.get('THINKIFIC_SUBDOMAIN')}.thinkific.com/users/password/new`;
      const trialEndFormatted = trialEndDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const emailBody = [
        `To: ${normalizedEmail}`,
        `From: Modal Education <contact@modalmath.com>`,
        `Subject: Your 14-Day Free Trial Has Started — Modal Math`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e003a;max-width:600px;margin:0 auto;padding:24px;">`,
        `<img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" alt="Modal Education" style="height:40px;margin-bottom:24px;" />`,
        `<h2 style="color:#1e003a;">Welcome to Modal Math, ${adminName}!</h2>`,
        `<p>Your <strong>14-day free trial</strong> for <strong>${districtName}</strong> is now active with <strong>${seats} teacher seats</strong>.</p>`,
        `<div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:10px;padding:14px 18px;margin:20px 0;font-size:14px;color:#7a5100;">`,
        `⏳ Trial ends: <strong>${trialEndFormatted}</strong>`,
        `</div>`,
        `<h3 style="color:#1e003a;">Get Started in 2 Steps</h3>`,
        `<ol style="line-height:2.2;color:#4b2865;font-size:15px;">`,
        `<li><strong>Set up your Modal Math password</strong> — <a href="${thinkificLoginUrl}" style="color:#520096;">Click here</a>, enter your email (${normalizedEmail}), and click "Send me reset password instructions".</li>`,
        `<li><strong>Invite your teachers</strong> from your Admin Dashboard — each teacher gets an automatic email to set up their account.</li>`,
        `</ol>`,
        `<p style="margin-top:28px;"><a href="${dashboardUrl}" style="background:#520096;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">Go to Admin Dashboard →</a></p>`,
        `<p style="margin-top:32px;color:#666;font-size:13px;">Questions? Email us at <a href="mailto:contact@modalmath.com" style="color:#520096;">contact@modalmath.com</a></p>`,
        `<p style="color:#666;font-size:13px;">— The Modal Education Team</p>`,
        `</body></html>`,
      ].join('\r\n');

      const raw = encodeEmailToBase64Url(emailBody);
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
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