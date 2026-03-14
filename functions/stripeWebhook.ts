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
  }

  return Response.json({ received: true });
});