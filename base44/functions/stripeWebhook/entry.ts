import Stripe from 'npm:stripe@14.21.0';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

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
      return Response.json({ success: true });
    }

    // Check if a license already exists for this admin
    const existing = await base44.asServiceRole.entities.DistrictLicense.filter({ adminEmail });

    if (existing.length > 0) {
      // Update existing license
      await base44.asServiceRole.entities.DistrictLicense.update(existing[0].id, {
        totalLicenses: Number(meta.seats),
        status: 'active',
        billingPeriod: meta.billing,
        pricePerSeat: Number(meta.pricePerSeat),
        purchaseDate: new Date().toISOString(),
        stripeCheckoutSessionId: session.id,
      });
    } else {
      // Create new license
      await base44.asServiceRole.entities.DistrictLicense.create({
        adminEmail,
        adminName: meta.adminName || '',
        districtName: meta.districtName || '',
        totalLicenses: Number(meta.seats),
        licensesUsed: 0,
        status: 'active',
        billingPeriod: meta.billing,
        pricePerSeat: Number(meta.pricePerSeat),
        purchaseDate: new Date().toISOString(),
        stripeCheckoutSessionId: session.id,
        invitedTeachers: [],
      });
    }

    console.log(`[stripeWebhook] ✓ License created/updated for ${adminEmail}, ${meta.seats} seats`);

    // Send admin notification email
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('gmail');
      const totalCost = Number(meta.seats) * Number(meta.pricePerSeat);
      const notifyBody = [
        `To: contact@modalmath.com`,
        `From: Modal Education <contact@modalmath.com>`,
        `Subject: 💰 New District Purchase — ${meta.districtName || adminEmail}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset=utf-8`,
        ``,
        `<h2>New District Purchase</h2>`,
        `<table style="border-collapse:collapse;font-family:Arial,sans-serif;">`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Name:</td><td style="padding:6px 12px;">${meta.adminName || '—'}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Email:</td><td style="padding:6px 12px;">${adminEmail}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">District:</td><td style="padding:6px 12px;">${meta.districtName || '—'}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Seats:</td><td style="padding:6px 12px;">${meta.seats}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Billing:</td><td style="padding:6px 12px;">${meta.billing}</td></tr>`,
        `<tr><td style="padding:6px 12px;font-weight:bold;">Price/Seat:</td><td style="padding:6px 12px;">$${meta.pricePerSeat}</td></tr>`,
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
    } catch (notifyErr) {
      console.warn('[stripeWebhook] Admin notification failed:', notifyErr.message);
    }
  }

  return Response.json({ received: true });
});