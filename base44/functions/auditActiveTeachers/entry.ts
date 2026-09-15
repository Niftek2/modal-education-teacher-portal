// One-time active-teacher reconciliation was intentionally disabled after verification.
Deno.serve(() => Response.json({ error: 'Audit disabled' }, { status: 410 }));
