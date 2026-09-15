import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const REPAIR_KEY = '2cfa3b224e2106f71f06553140bcd65d29afba54c5cace62fbaf7325625d1678';
const TARGET_EMAIL = 'kconnor@wausauschools.org';
const TARGET_NAME = 'Kearsten Connor';
const CLASSROOM_COURSE_ID = 552235;
const API_BASE = 'https://api.thinkific.com/api/public/v1';

function apiHeaders() {
  const token = Deno.env.get('THINKIFIC_API_ACCESS_TOKEN');
  if (!token) throw new Error('THINKIFIC_API_ACCESS_TOKEN is not configured');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function thinkificGet(path, query = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { headers: apiHeaders() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Thinkific GET ${path} failed with ${response.status}: ${body?.message || body?.error || 'Unknown error'}`);
  }
  return body;
}

async function listAll(path, query = {}, maxPages = 40) {
  const items = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await thinkificGet(path, { ...query, limit: 250, page });
    const pageItems = Array.isArray(data.items) ? data.items : [];
    items.push(...pageItems);
    const pagination = data.meta?.pagination;
    if (pagination) {
      if (!pagination.next_page || page >= Number(pagination.total_pages || page)) break;
      page = Number(pagination.next_page);
    } else {
      if (pageItems.length < 250) break;
      page += 1;
    }
  }
  return items;
}

async function getGroupMembers(groupId) {
  const data = await thinkificGet('/users', {
    'query[group_id]': groupId,
    limit: 250,
    page: 1,
  });
  return Array.isArray(data.items) ? data.items : [];
}

function isActiveEnrollment(enrollment) {
  if (!enrollment?.activated_at) return false;
  if (enrollment.expired === true) return false;
  if (enrollment.expiry_date && new Date(enrollment.expiry_date).getTime() <= Date.now()) return false;
  return true;
}

function publicUser(user) {
  return {
    id: user.id,
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    email: String(user.email || '').toLowerCase().trim(),
    externalSource: user.external_source || null,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    if (body.repairKey !== REPAIR_KEY) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (body.mode !== 'inspect') {
      return Response.json({ error: 'Only inspect mode is currently enabled' }, { status: 400 });
    }

    createClientFromRequest(req);

    const userData = await thinkificGet('/users', { 'query[email]': TARGET_EMAIL, limit: 10 });
    const teacher = (userData.items || []).find(
      (user) => String(user.email || '').toLowerCase().trim() === TARGET_EMAIL
    );
    if (!teacher) {
      return Response.json({ error: 'Kearsten was not found in Thinkific' }, { status: 404 });
    }

    const [enrollments, groups, users] = await Promise.all([
      listAll('/enrollments', { 'query[user_id]': teacher.id }, 10),
      listAll('/groups', {}, 20),
      listAll('/users', {}, 40),
    ]);

    const nameNeedles = [
      TARGET_NAME.toLowerCase(),
      'kearsten',
      'connor',
      TARGET_EMAIL.split('@')[0],
    ];
    const candidateGroups = groups.filter((group) => {
      const name = String(group.name || '').toLowerCase();
      return nameNeedles.some((needle) => name.includes(needle));
    });

    const groupDetails = [];
    for (const group of candidateGroups) {
      const members = await getGroupMembers(group.id);
      groupDetails.push({
        id: String(group.id),
        name: group.name,
        teacherIsMember: members.some((member) => Number(member.id) === Number(teacher.id)),
        members: members.map(publicUser),
      });
    }

    const externalSourceStudents = users
      .filter((user) =>
        String(user.external_source || '').trim().toLowerCase() === TARGET_NAME.toLowerCase() &&
        String(user.email || '').toLowerCase().endsWith('@modalmath.com')
      )
      .map(publicUser);

    const groupStudents = groupDetails
      .flatMap((group) => group.members)
      .filter((user) => user.email.endsWith('@modalmath.com'));

    const rosterByEmail = new Map();
    for (const student of [...groupStudents, ...externalSourceStudents]) {
      rosterByEmail.set(student.email, student);
    }

    const classroomEnrollments = enrollments
      .filter((enrollment) => Number(enrollment.course_id || enrollment.course?.id) === CLASSROOM_COURSE_ID)
      .map((enrollment) => ({
        id: enrollment.id,
        courseId: Number(enrollment.course_id || enrollment.course?.id),
        courseName: enrollment.course?.name || 'Your Classroom',
        activatedAt: enrollment.activated_at || null,
        expiryDate: enrollment.expiry_date || null,
        expired: enrollment.expired === true,
        active: isActiveEnrollment(enrollment),
      }));

    return Response.json({
      success: true,
      mode: 'inspect',
      teacher: publicUser(teacher),
      classroomEnrollments,
      hasActiveClassroomEnrollment: classroomEnrollments.some((enrollment) => enrollment.active),
      totalGroupsScanned: groups.length,
      candidateGroups: groupDetails,
      externalSourceStudents,
      rosterCandidates: Array.from(rosterByEmail.values()),
      rosterCandidateCount: rosterByEmail.size,
    });
  } catch (error) {
    console.error('[repairKearstenAccess] inspect failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
