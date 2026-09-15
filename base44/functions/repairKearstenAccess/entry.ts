// One-time Kearsten access diagnostic was intentionally disabled after verification.
Deno.serve(() => Response.json({ error: 'Diagnostic disabled' }, { status: 410 }));
