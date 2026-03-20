import Stripe from 'npm:stripe@14.21.0';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

const PRICE_PER_SEAT = {
  annual: { 1: 179, 5: 159, 15: 139, 30: 119 },
  monthly: { 1: 19, 5: 17, 15: 15, 30: 13 }
};

function getPriceForSeats(seats, billing) {
  const tiers = PRICE_PER_SEAT[billing];
  if (seats >= 30) return tiers[30];
  if (seats >= 15) return tiers[15];
  if (seats >= 5) return tiers[5];
  return tiers[1];
}

Deno.serve(async (req) => {
  try {
    const { seats, billing, adminEmail, adminName, districtName, successUrl, cancelUrl } = await req.json();

    if (!seats || !billing) {
      return Response.json({ error: 'seats and billing are required' }, { status: 400 });
    }

    const pricePerSeat = getPriceForSeats(seats, billing);
    const totalCents = Math.round(pricePerSeat * seats * 100);
    const intervalLabel = billing === 'annual' ? '/teacher/year' : '/teacher/month';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Modal Math District License — ${seats} Teacher Seat${seats > 1 ? 's' : ''}`,
            description: `$${pricePerSeat}${intervalLabel} · ${seats} seat${seats > 1 ? 's' : ''}`,
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      }],
      customer_email: adminEmail,
      metadata: {
        adminEmail,
        adminName: adminName || '',
        districtName: districtName || '',
        seats: String(seats),
        billing,
        pricePerSeat: String(pricePerSeat),
      },
      success_url: successUrl || `${req.headers.get('origin')}/DistrictAdminDashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.headers.get('origin')}/DistrictPricing`,
    });

    return Response.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});