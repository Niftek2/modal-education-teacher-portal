import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        // Only admins can invite other admins
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Only admins can invite users' }, { status: 403 });
        }

        const { email } = await req.json();
        
        if (!email) {
            return Response.json({ error: 'Email is required' }, { status: 400 });
        }

        // Invite the user as admin
        await base44.users.inviteUser(email, 'admin');
        
        return Response.json({ 
            success: true,
            message: `Admin invite sent to ${email}`
        });

    } catch (error) {
        console.error('Invite error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});