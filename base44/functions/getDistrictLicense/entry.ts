import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { adminEmail } = await req.json();

    if (!adminEmail) {
      return Response.json({ error: 'adminEmail is required' }, { status: 400 });
    }

    const normalizedEmail = adminEmail.toLowerCase().trim();
    const licenses = await base44.asServiceRole.entities.DistrictLicense.filter({ adminEmail: normalizedEmail });

    if (licenses.length === 0) {
      return Response.json({ license: null });
    }

    const license = licenses[0];

    // Check if trial has expired
    if (license.status === 'trial' && license.trialEndDate && new Date(license.trialEndDate) < new Date()) {
      await base44.asServiceRole.entities.DistrictLicense.update(license.id, { status: 'expired' });
      license.status = 'expired';
    }

    return Response.json({ license });
  } catch (error) {
    console.error('Get district license error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});