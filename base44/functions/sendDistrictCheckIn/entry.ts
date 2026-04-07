import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

function encodeEmailToBase64Url(emailString) {
    const bytes = new TextEncoder().encode(emailString);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildCheckInEmailHtml({ adminName, districtName, dashboardUrl }) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(82,0,150,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1e003a;padding:28px 40px;text-align:center;">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" alt="Modal Education" style="height:44px;" />
            <p style="color:#c4a9e8;margin:10px 0 0;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Modal Math for Districts</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="color:#1e003a;margin:0 0 12px;font-size:22px;">Hi ${adminName},</h2>
            <p style="color:#4b2865;font-size:15px;line-height:1.7;margin:0 0 20px;">
              It's been 5 days since <strong>${districtName}</strong> started your free trial of Modal Math — and we wanted to check in!
            </p>
            <p style="color:#4b2865;font-size:15px;line-height:1.7;margin:0 0 20px;">
              We'd love to hear how it's going. Are your teachers getting started? Do you have any questions or need help with anything?
            </p>

            <!-- Feedback box -->
            <div style="background:#f5f3ff;border-left:4px solid #7c3aed;border-radius:8px;padding:16px 20px;margin:24px 0;">
              <p style="margin:0;font-size:14px;color:#4b2865;font-weight:bold;">A few quick questions:</p>
              <ul style="margin:10px 0 0;padding-left:18px;color:#4b2865;font-size:14px;line-height:2;">
                <li>Have your teachers been able to log in and explore?</li>
                <li>Is the content matching what your students need?</li>
                <li>Anything we can improve or clarify?</li>
              </ul>
            </div>

            <p style="color:#4b2865;font-size:15px;line-height:1.7;margin:0 0 28px;">
              Just hit reply — we read every response and would love to hear from you.
            </p>

            <!-- CTA Button -->
            <p style="text-align:center;margin:0 0 32px;">
              <a href="${dashboardUrl}" style="background:#520096;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">
                Go to Your Dashboard &rarr;
              </a>
            </p>

            <!-- Upgrade nudge -->
            <div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:10px;padding:16px 20px;text-align:center;">
              <p style="margin:0 0 8px;font-size:14px;color:#7a5100;font-weight:bold;">Ready to upgrade?</p>
              <p style="margin:0 0 12px;font-size:13px;color:#7a5100;">Unlock unlimited teacher seats and keep your students learning all year.</p>
              <a href="https://modal-math.base44.app/DistrictPricing" style="background:#f59e0b;color:#1e003a;padding:10px 24px;text-decoration:none;border-radius:7px;display:inline-block;font-weight:bold;font-size:14px;">
                View Pricing Plans
              </a>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f5f3ff;padding:20px 40px;text-align:center;border-top:1px solid #ede9fe;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Modal Education &bull; <a href="mailto:contact@modalmath.com" style="color:#7c3aed;text-decoration:none;">contact@modalmath.com</a>
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:#c4a9e8;">You're receiving this because you started a free trial for ${districtName}.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // If called with a specific email (e.g. preview), use that. Otherwise run for all 5-day trials.
        const body = await req.json().catch(() => ({}));
        const previewEmail = body.previewEmail || null;

        const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');

        let targets = [];

        if (previewEmail) {
            // Preview mode: send to specified email with dummy data
            targets = [{
                adminEmail: previewEmail,
                adminName: 'District Admin',
                districtName: 'Your School District',
            }];
        } else {
            // Production mode: find all trials that started exactly 5 days ago
            const allLicenses = await base44.asServiceRole.entities.DistrictLicense.filter({ status: 'trial' });
            const now = new Date();
            targets = allLicenses.filter(l => {
                if (!l.created_date) return false;
                const created = new Date(l.created_date);
                const diffDays = (now - created) / (1000 * 60 * 60 * 24);
                return diffDays >= 5 && diffDays < 6;
            }).map(l => ({
                adminEmail: l.adminEmail,
                adminName: l.adminName || 'District Admin',
                districtName: l.districtName || 'your district',
            }));
        }

        const results = [];
        for (const t of targets) {
            const dashboardUrl = `https://modal-math.base44.app/DistrictAdminDashboard?email=${encodeURIComponent(t.adminEmail)}`;
            const htmlBody = buildCheckInEmailHtml({ adminName: t.adminName, districtName: t.districtName, dashboardUrl });

            const emailRaw = [
                `To: ${t.adminEmail}`,
                `From: Modal Education <contact@modalmath.com>`,
                `Subject: How is your Modal Math trial going, ${t.adminName.split(' ')[0]}?`,
                `MIME-Version: 1.0`,
                `Content-Type: text/html; charset=UTF-8`,
                ``,
                htmlBody,
            ].join('\r\n');

            const raw = encodeEmailToBase64Url(emailRaw);

            const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw }),
            });

            const data = await res.json();
            results.push({ email: t.adminEmail, status: res.ok ? 'sent' : 'error', detail: data });
        }

        return Response.json({ success: true, sent: results.length, results });
    } catch (error) {
        console.error('[sendDistrictCheckIn] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});