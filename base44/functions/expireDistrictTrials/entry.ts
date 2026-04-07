import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const THINKIFIC_API_TOKEN = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
const THINKIFIC_SUBDOMAIN = Deno.env.get('THINKIFIC_SUBDOMAIN');
const thinkificHeaders = {
    'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
    'Content-Type': 'application/json',
};

function encodeEmailToBase64Url(emailString) {
    const bytes = new TextEncoder().encode(emailString);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getThinkificUserId(email) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
        { headers: thinkificHeaders }
    );
    const data = await res.json();
    return data.items?.[0]?.id || null;
}

async function getAllEnrollments(userId) {
    const res = await fetch(
        `https://api.thinkific.com/api/public/v1/enrollments?user_id=${userId}&limit=100`,
        { headers: thinkificHeaders }
    );
    const data = await res.json();
    return data.items || [];
}

async function expireEnrollment(enrollmentId) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await fetch(`https://api.thinkific.com/api/public/v1/enrollments/${enrollmentId}`, {
        method: 'PUT',
        headers: thinkificHeaders,
        body: JSON.stringify({ expiry_date: yesterday.toISOString(), activated_at: null }),
    });
}

async function sendExpiryEmail(accessToken, adminEmail, adminName, districtName) {
    const upgradeUrl = 'https://www.modalmath.com/DistrictPricing';
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(82,0,150,0.08);">
        <tr>
          <td style="background:#1e003a;padding:28px 40px;text-align:center;">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" alt="Modal Education" style="height:44px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="color:#1e003a;margin:0 0 16px;">Your Modal Math trial has ended</h2>
            <p style="color:#4b2865;font-size:15px;line-height:1.7;margin:0 0 16px;">
              Hi ${adminName}, your 14-day free trial for <strong>${districtName}</strong> has now expired and teacher access has been deactivated.
            </p>
            <p style="color:#4b2865;font-size:15px;line-height:1.7;margin:0 0 28px;">
              The good news — all the work your teachers did during the trial is saved and will be fully restored the moment you upgrade. No data is lost.
            </p>
            <p style="text-align:center;margin:0 0 32px;">
              <a href="${upgradeUrl}" style="background:#520096;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">
                Upgrade Now &rarr;
              </a>
            </p>
            <p style="color:#666;font-size:13px;text-align:center;">Questions? Reply to this email or contact <a href="mailto:contact@modalmath.com" style="color:#7c3aed;">contact@modalmath.com</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#f5f3ff;padding:16px 40px;text-align:center;border-top:1px solid #ede9fe;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">Modal Education &bull; contact@modalmath.com</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    const raw = encodeEmailToBase64Url([
        `To: ${adminEmail}`,
        `From: Modal Education <contact@modalmath.com>`,
        `Subject: Your Modal Math trial has ended - upgrade to keep access`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=UTF-8`,
        ``,
        html,
    ].join('\r\n'));

    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
    });
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Find all trial licenses where trialEndDate has passed
        const allTrials = await base44.asServiceRole.entities.DistrictLicense.filter({ status: 'trial' });
        const now = new Date();
        const expired = allTrials.filter(l => l.trialEndDate && new Date(l.trialEndDate) < now);

        if (expired.length === 0) {
            return Response.json({ success: true, expired: 0 });
        }

        const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
        const results = [];

        for (const license of expired) {
            const { adminEmail, adminName, districtName, invitedTeachers = [] } = license;
            console.log(`[expireDistrictTrials] Expiring trial for ${adminEmail}`);

            // 1. Mark license as expired (preserve all data)
            await base44.asServiceRole.entities.DistrictLicense.update(license.id, { status: 'expired' });

            // 2. Unenroll all invited teachers from Thinkific
            for (const teacherEmail of invitedTeachers) {
                const userId = await getThinkificUserId(teacherEmail);
                if (!userId) continue;
                const enrollments = await getAllEnrollments(userId);
                for (const enrollment of enrollments) {
                    await expireEnrollment(enrollment.id);
                }
            }

            // 3. Send expiry email to admin
            try {
                await sendExpiryEmail(accessToken, adminEmail, adminName || 'District Admin', districtName || 'your district');
            } catch (emailErr) {
                console.warn(`[expireDistrictTrials] Email failed for ${adminEmail}:`, emailErr.message);
            }

            results.push({ adminEmail, teachersDeactivated: invitedTeachers.length });
        }

        return Response.json({ success: true, expired: results.length, results });
    } catch (error) {
        console.error('[expireDistrictTrials] Error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});