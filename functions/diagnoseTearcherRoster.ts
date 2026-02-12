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

Deno.serve(async (req) => {
    try {
        const body = await req.json();
        const { sessionToken } = body;
        
        const session = await verifySession(sessionToken);
        const teacherId = session.userId;
        const teacherEmail = session.email;
        
        console.log(`[DIAG] Teacher: ${teacherEmail} (ID: ${teacherId})`);
        
        const diagnosis = {
            teacher: { email: teacherEmail, id: teacherId },
            groups: [],
            studentCount: 0
        };
        
        // Fetch all groups
        const groupsResponse = await fetch(`https://api.thinkific.com/api/public/v1/groups`, {
            headers: {
                'X-Auth-API-Key': THINKIFIC_API_KEY,
                'X-Auth-Subdomain': THINKIFIC_SUBDOMAIN,
                'Content-Type': 'application/json'
            }
        });
        
        const groupsData = await groupsResponse.json();
        const allGroups = groupsData.items || [];
        
        console.log(`[DIAG] Total groups in system: ${allGroups.length}`);
        
        // For each group, check if teacher is a member and count students
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
            const students = members.filter(m => m.email?.toLowerCase().endsWith('@modalmath.com'));
            
            if (isMember) {
                diagnosis.groups.push({
                    id: group.id,
                    name: group.name,
                    totalMembers: members.length,
                    studentCount: students.length,
                    studentEmails: students.map(s => s.email)
                });
                diagnosis.studentCount += students.length;
            }
        }
        
        console.log(`[DIAG] Teacher is member of ${diagnosis.groups.length} groups with ${diagnosis.studentCount} total students`);
        
        return Response.json(diagnosis, { status: 200 });
    } catch (error) {
        console.error('[DIAG] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});