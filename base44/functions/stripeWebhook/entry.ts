import Stripe from 'npm:stripe@14.21.0';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

const THINKIFIC_API_TOKEN = Deno.env.get("THINKIFIC_API_ACCESS_TOKEN");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");

const thinkificHeaders = {
  'Authorization': `Bearer ${THINKIFIC_API_TOKEN}`,
  'Content-Type': 'application/json',
};

async function findOrCreateThinkificUser(email, fullName) {
  // Try to find existing user
  const searchRes = await fetch(
    `https://api.thinkific.com/api/public/v1/users?query[email]=${encodeURIComponent(email)}`,
    { headers: thinkificHeaders }
  );
  const searchData = await searchRes.json();
  if (searchData.items?.[0]) return searchData.items[0];

  // Create new user
  const parts = (fullName || email.split('@')[0]).split(' ');
  const firstName = parts[0] || 'Admin';
  const lastName = parts.slice(1).join(' ') || '';

  const createRes = await fetch('https://api.thinkific.com/api/public/v1/users', {
    method: 'POST',
    headers: thinkificHeaders,
    body: JSON.stringify({ first_name: firstName, last_name: lastName, email, send_welcome_email: false }),
  });
  const createData = await createRes.json();
  if (!createRes.ok) throw new Error(`Failed to create Thinkific user: ${createData?.message || createRes.status}`);
  return createData;
}

async function sendWelcomeEmail(accessToken, adminEmail, adminName, districtName, seats, billing) {
  const dashboardUrl = `https://modal-math.base44.app/DistrictAdminDashboard?email=${encodeURIComponent(adminEmail)}`;
  const thinkificLoginUrl = `https://${THINKIFIC_SUBDOMAIN}.thinkific.com/users/password/new`;

  const emailBody = [
    `To: ${adminEmail}`,
    `From: Modal Education <contact@modalmath.com>`,
    `Subject: Welcome to Modal Math — Your District Account is Ready`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1e003a;max-width:600px;margin:0 auto;padding:24px;">`,
    `<img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/698c9549de63fc919dec560c/f76ad98a9_LogoNoScript.png" alt="Modal Education" style="height:40px;margin-bottom:24px;" />`,
    `<h2 style="color:#1e003a;">Welcome to Modal Math, ${adminName || 'District Admin'}!</h2>`,
    `<p>Your purchase is confirmed. Here's what you have:</p>`,
    `<div style="background:#f7f2fd;border-radius:12px;padding:16px 20px;margin:20px 0;">`,
    `<strong style="color:#520096;">${districtName || 'Your District'}</strong><br/>`,
    `<span style="font-size:15px;">${seats} teacher seat${seats > 1 ? 's' : ''} · ${billing === 'annual' ? 'Annual' : 'Monthly'} plan</span>`,
    `</div>`,
    `<h3 style="color:#1e003a;">Next Steps</h3>`,
    `<ol style="line-height:2;color:#4b2865;">`,
    `<li><strong>Set up your Modal Math account password</strong> — <a href="${thinkificLoginUrl}" style="color:#520096;">Click here</a> and enter your email (${adminEmail}) to receive a reset link.</li>`,
    `<li><strong>Go to your Admin Dashboard</strong> — <a href="${dashboardUrl}" style="color:#520096;">Click here</a> to invite your teachers and manage your seats.</li>`,
    `<li><strong>Invite your teachers</strong> — Each teacher will receive an email to set up their account and will be enrolled in all Modal Math courses automatically.</li>`,
    `</ol>`,
    `<p style="margin-top:32px;"><a href="${dashboardUrl}" style="background:#520096;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px;">Go to Admin Dashboard →</a></p>`,
    `<p style="margin-top:32px;color:#666;font-size:13px;">Questions? Email us at <a href="mailto:contact@modalmath.com" style="color:#520096;">contact@modalmath.com</a></p>`,
    `<p style="color:#666;font-size:13px;">— The Modal Education Team</p>`,
    `</body></html>`,
  ].join('\r\n');

  const encoder = new TextEncoder();
  const bytes = encoder.encode(emailBody);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const raw = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!gmailRes.ok) {
    const err = await gmailRes.text();
    throw new Error(`Gmail send failed: ${err}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata || {};
    const base44 = createClientFromRequest(req);

    const adminEmail = meta.adminEmail?.toLowerCase().trim();
    if (!adminEmail) {
      console.warn('[stripeWebhook] No adminEmail in metadata — skipping provisioning');
      return Response.json({ received: true });
    }

    const seats = Number(meta.seats);
    const billing = meta.billing;
    const adminName = meta.adminName || '';
    const districtName = meta.districtName || '';
    const pricePerSeat = Number(meta.pricePerSeat);

    // 1. Create or update DistrictLicense
    const existing = await base44.asServiceRole.entities.DistrictLicense.filter({ adminEmail });
    if (existing.length > 0) {
      await base44.asServiceRole.entities.DistrictLicense.update(existing[0].id, {
        totalLicenses: seats,
        status: 'active',
        billingPeriod: billing,
        pricePerSeat,
        purchaseDate: new Date().toISOString(),
        stripeCheckoutSessionId: session.id,
        adminName,
        districtName,
      });
    } else {
      await base44.asServiceRole.entities.DistrictLicense.create({
        adminEmail,
        adminName,
        districtName,
        totalLicenses: seats,
        licensesUsed: 0,
        status: 'active',
        billingPeriod: billing,
        pricePerSeat,
        purchaseDate: new Date().toISOString(),
        stripeCheckoutSessionId: session.id,
        invitedTeachers: [],
      });
    }
    console.log(`[stripeWebhook] ✓ License created/updated for ${adminEmail}, ${seats} seats`);

    // 2. Create Thinkific account for admin
    try {
      await findOrCreateThinkificUser(adminEmail, adminName);
      console.log(`[stripeWebhook] ✓ Thinkific account ready for admin ${adminEmail}`);
    } catch (err) {
      console.warn(`[stripeWebhook] Thinkific user creation failed: ${err.message}`);
    }

    // 3. Send welcome email to admin + internal notification
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');

      // Welcome email to admin
      await sendWelcomeEmail(accessToken, adminEmail, adminName, districtName, seats, billing);
      console.log(`[stripeWebhook] ✓ Welcome email sent to ${adminEmail}`);

      // Internal notification
      const totalCost = seats * pricePerSeat;
      const notifyBody = [
        `To: contact@modalmath.com`,
        `From: Modal Education <contact@modalmath.com>`,
        `Subject: 💰 New District Purchase — ${districtName || adminEmail}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<h2>New District Purchase</h2>`,
        `<table style="border-collapse:collapse;font-family:Arial,sans-serif;">`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Name:</td><td style="padding:6px 12px;">${adminName || '—'}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Email:</td><td style="padding:6px 12px;">${adminEmail}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">District:</td><td style="padding:6px 12px;">${districtName || '—'}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Seats:</td><td style="padding:6px 12px;">${seats}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Billing:</td><td style="padding:6px 12px;">${billing}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Price/Seat:</td><td style="padding:6px 12px;">$${pricePerSeat}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Total:</td><td style="padding:6px 12px;font-size:1.1em;color:#15803d;"><strong>$${totalCost.toLocaleString()}</strong></td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Stripe Session:</td><td style="padding:6px 12px;">${session.id}</td></tr>`,
        `</table>`,
      ].join('\r\n');
      const encoded = btoa(unescape(encodeURIComponent(notifyBody))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
      });
    } catch (emailErr) {
      console.warn('[stripeWebhook] Email sending failed:', emailErr.message);
    }
  }

  return Response.json({ received: true });
});