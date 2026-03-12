import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { jwtVerify } from 'npm:jose@5.9.6';

const THINKIFIC_BASE = 'https://api.thinkific.com/api/public/v1';

async function requireSession(token) {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(Deno.env.get('JWT_SECRET'));
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== 'session') return null;
    return payload;
  } catch { return null; }
}

async function thinkificGet(path) {
  const token = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
  return fetch(`${THINKIFIC_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const session = await requireSession(body.sessionToken);
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const base44 = createClientFromRequest(req);

    // Get Thinkific user data
    let thinkificUser = null;
    try {
      const res = await thinkificGet(`/users/${session.userId}`);
      if (res.ok) thinkificUser = await res.json();
    } catch (e) {
      console.warn('Thinkific user fetch failed:', e.message);
    }

    // Get groups from DB first (fast)
    const dbGroups = await base44.asServiceRole.entities.TeacherGroup.filter({ teacherEmail: session.email });
    let groups = dbGroups.map(g => ({ id: g.thinkificGroupId, name: g.groupName }));

    // If no DB groups, try Thinkific
    if (groups.length === 0 && session.userId) {
      try {
        let page = 1;
        while (true) {
          const res = await thinkificGet(`/groups?page=${page}&per_page=50`);
          if (!res.ok) break;
          const data = await res.json();
          const items = data.items || [];
          if (items.length === 0) break;

          for (const group of items) {
            const membersRes = await thinkificGet(`/users?query[group_id]=${group.id}&limit=100`);
            if (membersRes.ok) {
              const membersData = await membersRes.json();
              const isMember = membersData.items?.some(u => u.id === Number(session.userId));
              if (isMember) {
                groups.push({ id: String(group.id), name: group.name });
                // Save to DB for future fast lookup
                await base44.asServiceRole.entities.TeacherGroup.create({
                  teacherEmail: session.email,
                  thinkificGroupId: String(group.id),
                  groupName: group.name
                }).catch(() => {});
              }
            }
          }
          if (items.length < 50) break;
          page++;
        }
      } catch (e) {
        console.warn('Could not fetch Thinkific groups:', e.message);
      }
    }

    const teacher = thinkificUser ? {
      id: thinkificUser.id,
      firstName: thinkificUser.first_name || '',
      lastName: thinkificUser.last_name || '',
      email: thinkificUser.email || session.email
    } : {
      id: session.userId,
      email: session.email,
      firstName: '',
      lastName: ''
    };

    return Response.json({ teacher, groups });
  } catch (error) {
    console.error('getTeacherData error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});