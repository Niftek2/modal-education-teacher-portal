import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as jose from 'npm:jose@5.2.0';

const THINKIFIC_API_KEY = Deno.env.get("THINKIFIC_API_KEY");
const THINKIFIC_SUBDOMAIN = Deno.env.get("THINKIFIC_SUBDOMAIN");
const JWT_SECRET = Deno.env.get("JWT_SECRET");

async function verifySession(token) {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    return payload;
}

async function getTeacherStudentEmails(teacherId) {
    // Get all groups where teacher is a member
    const groupsResponse = await fetch(`https://api.thinkific.com/api/public/v1/groups`, {
        headers: {
            'X-Auth-API-Key': THINKIFIC_API_KEY,
            'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
            'Content-Type': 'application/json'
        }
    });
    
    const groupsData = await groupsResponse.json();
    const allGroups = groupsData.items || [];
    
    const studentEmails = new Set();
    
    for (const group of allGroups) {
        const membersResponse = await fetch(`https://api.thinkific.com/api/public/v1/users?query[group_id]=${group.id}`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        if (!membersResponse.ok) continue;
        
        const membersData = await membersResponse.json();
        const members = membersData.items || [];
        
        const isMember = members.some(m => String(m.id) === String(teacherId));
        if (isMember) {
            members.forEach(m => {
                if (m.email?.toLowerCase().endsWith('@modalmath.com')) {
                    studentEmails.add(m.email.toLowerCase());
                }
            });
        }
    }
    
    return Array.from(studentEmails);
}

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken, limit = 50 } = body;
        
        const session = await verifySession(sessionToken);
        const teacherId = session.userId;
        
        // Get student emails in teacher's rosters
        const studentEmails = await getTeacherStudentEmails(teacherId);
        
        // Fetch all activity events
        const base44 = createClientFromRequest(req);
        const allEvents = await base44.asServiceRole.entities.ActivityEvent.list('-created_date', 500);
        
        // Filter to only events for students in this teacher's roster
        const filtered = allEvents
            .filter(e => studentEmails.includes(e.studentEmail?.toLowerCase()))
            .slice(0, limit);
        
        return Response.json({
            studentEmails,
            events: filtered
        }, { status: 200 });
    } catch (error) {
        console.error('[ACTIVITY] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});