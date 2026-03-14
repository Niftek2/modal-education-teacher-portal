import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { Users, Mail, CheckCircle2, AlertCircle, Clock, Plus, X } from 'lucide-react';

export default function DistrictAdminDashboard() {
  const [email, setEmail] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [error, setError] = useState('');

  // Auto-load from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlEmail = params.get('email');
    const sessionId = params.get('session_id');
    if (urlEmail) {
      setEmail(urlEmail);
      setEmailInput(urlEmail);
      loadLicense(urlEmail);
    }
    if (sessionId && !urlEmail) {
      // Payment just completed — prompt for email
    }
  }, []);

  const loadLicense = async (adminEmail) => {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('getDistrictLicense', { adminEmail });
      if (res.data?.license) {
        setLicense(res.data.license);
        setEmail(adminEmail);
      } else {
        setError('No license found for this email address. Please check your email or contact contact@modalmath.com.');
        setLicense(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to load license.');
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async (e) => {
    e.preventDefault();
    if (!emailInput) return;
    setLookupLoading(true);
    await loadLicense(emailInput.toLowerCase().trim());
    setLookupLoading(false);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    setInviteSuccess('');
    if (!inviteEmail) return;
    setInviteLoading(true);
    try {
      const res = await base44.functions.invoke('inviteDistrictTeacher', {
        adminEmail: email,
        teacherEmail: inviteEmail,
      });
      if (res.data?.success) {
        setInviteSuccess(`Invite sent to ${inviteEmail}!`);
        setInviteEmail('');
        // Refresh license data
        await loadLicense(email);
      } else {
        setInviteError(res.data?.error || 'Failed to send invite.');
      }
    } catch (err) {
      setInviteError(err.message || 'Failed to send invite.');
    } finally {
      setInviteLoading(false);
    }
  };

  const statusColors = { active: '#15803d', trial: '#d97706', expired: '#dc2626', canceled: '#6b7280' };
  const statusLabels = { active: 'Active', trial: 'Free Trial', expired: 'Expired', canceled: 'Canceled' };

  const licensesRemaining = license ? license.totalLicenses - (license.licensesUsed || 0) : 0;
  const trialDaysLeft = license?.status === 'trial' && license.trialEndDate
    ? Math.max(0, Math.ceil((new Date(license.trialEndDate) - new Date()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', background: '#f7f2fd', color: '#1e003a' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e003a 0%, #520096 100%)', padding: '32px 24px', color: 'white' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', fontWeight: 400, marginBottom: 4 }}>District Admin Dashboard</h1>
            {license && <p style={{ opacity: 0.85, fontSize: 15 }}>{license.districtName || license.adminEmail}</p>}
          </div>
          <Link to={createPageUrl('DistrictPricing')} style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, textDecoration: 'underline' }}>← Back to Pricing</Link>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>

        {/* Email Lookup */}
        {!license && (
          <div style={{ background: 'white', borderRadius: 20, padding: '36px', border: '1.5px solid #e5d6f8', maxWidth: 520, margin: '0 auto' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e003a', marginBottom: 8 }}>Access Your Dashboard</h2>
            <p style={{ color: '#4b2865', fontSize: 14, marginBottom: 24 }}>Enter the email address you used when purchasing or starting your trial.</p>
            <form onSubmit={handleLookup} style={{ display: 'flex', gap: 12 }}>
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="admin@district.edu"
                required
                style={{ flex: 1, border: '1.5px solid #d4aff5', borderRadius: 10, padding: '10px 14px', fontSize: 15, outline: 'none' }}
              />
              <button type="submit" disabled={lookupLoading}
                style={{ background: '#520096', color: 'white', border: 'none', borderRadius: 10, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
                {lookupLoading ? '...' : 'Access'}
              </button>
            </form>
            {error && (
              <div style={{ marginTop: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', fontSize: 14 }}>
                {error}
              </div>
            )}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #ede0fb', textAlign: 'center', fontSize: 13, color: '#888' }}>
              Don't have an account yet?{' '}
              <Link to={createPageUrl('DistrictPricing')} style={{ color: '#520096', fontWeight: 600 }}>View Pricing</Link>
              {' '}or{' '}
              <Link to={createPageUrl('DistrictTrial')} style={{ color: '#520096', fontWeight: 600 }}>Start Free Trial</Link>
            </div>
          </div>
        )}

        {/* License Dashboard */}
        {license && (
          <div>
            {/* Status Banner */}
            {license.status === 'trial' && (
              <div style={{ background: trialDaysLeft <= 3 ? '#fef2f2' : '#fffbeb', border: `1px solid ${trialDaysLeft <= 3 ? '#fca5a5' : '#fcd34d'}`, borderRadius: 12, padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Clock size={20} color={trialDaysLeft <= 3 ? '#dc2626' : '#d97706'} />
                <div>
                  <span style={{ fontWeight: 700, color: trialDaysLeft <= 3 ? '#dc2626' : '#d97706' }}>
                    Free Trial — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining
                  </span>
                  <span style={{ color: '#6b7280', fontSize: 13, marginLeft: 12 }}>
                    Ends {new Date(license.trialEndDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  {' · '}
                  <Link to={createPageUrl('DistrictPricing')} style={{ color: '#520096', fontSize: 13, fontWeight: 600 }}>Upgrade Now →</Link>
                </div>
              </div>
            )}
            {license.status === 'expired' && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '14px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                <AlertCircle size={20} color="#dc2626" />
                <span style={{ fontWeight: 700, color: '#dc2626' }}>Your license has expired. </span>
                <Link to={createPageUrl('DistrictPricing')} style={{ color: '#520096', fontWeight: 600, marginLeft: 4 }}>Renew your plan →</Link>
              </div>
            )}

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
              {[
                { icon: <Users size={22} color="#520096" />, label: 'Total Licenses', value: license.totalLicenses },
                { icon: <CheckCircle2 size={22} color="#15803d" />, label: 'Seats Used', value: license.licensesUsed || 0 },
                { icon: <Plus size={22} color="#d97706" />, label: 'Seats Remaining', value: licensesRemaining },
                {
                  icon: <span style={{ fontSize: 18 }}>{license.status === 'trial' ? '🕐' : '✅'}</span>,
                  label: 'Status',
                  value: <span style={{ color: statusColors[license.status] || '#1e003a', fontWeight: 800, fontSize: 18 }}>{statusLabels[license.status] || license.status}</span>
                },
              ].map(({ icon, label, value }) => (
                <div key={label} style={{ background: 'white', borderRadius: 16, padding: '20px 22px', border: '1.5px solid #e5d6f8', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{icon}<span style={{ fontSize: 13, fontWeight: 600, color: '#4b2865' }}>{label}</span></div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#1e003a' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* License Usage Bar */}
            <div style={{ background: 'white', borderRadius: 16, padding: '24px', border: '1.5px solid #e5d6f8', marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 14, fontWeight: 600, color: '#1e003a' }}>
                <span>License Usage</span>
                <span>{license.licensesUsed || 0} / {license.totalLicenses} seats used</span>
              </div>
              <div style={{ background: '#ede0fb', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                <div style={{ background: licensesRemaining === 0 ? '#dc2626' : '#520096', height: '100%', width: `${Math.min(100, ((license.licensesUsed || 0) / license.totalLicenses) * 100)}%`, borderRadius: 999, transition: 'width 0.3s' }} />
              </div>
              {licensesRemaining === 0 && (
                <p style={{ marginTop: 8, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>All seats are used. <Link to={createPageUrl('DistrictPricing')} style={{ color: '#520096' }}>Purchase more seats →</Link></p>
              )}
            </div>

            {/* Invite Teachers */}
            {license.status !== 'expired' && license.status !== 'canceled' && (
              <div style={{ background: 'white', borderRadius: 16, padding: '28px', border: '1.5px solid #e5d6f8', marginBottom: 28 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e003a', marginBottom: 6 }}>Invite Teachers</h3>
                <p style={{ fontSize: 14, color: '#4b2865', marginBottom: 20 }}>Each teacher will receive an email with instructions to create their Modal Math account. Each invite uses 1 license seat.</p>

                <form onSubmit={handleInvite} style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="teacher@school.edu"
                    required
                    disabled={licensesRemaining === 0}
                    style={{ flex: 1, minWidth: 200, border: '1.5px solid #d4aff5', borderRadius: 10, padding: '10px 14px', fontSize: 15, outline: 'none', background: licensesRemaining === 0 ? '#f9f9f9' : 'white' }}
                  />
                  <button type="submit" disabled={inviteLoading || licensesRemaining === 0}
                    style={{ background: '#520096', color: 'white', border: 'none', borderRadius: 10, padding: '10px 24px', fontWeight: 700, cursor: licensesRemaining === 0 ? 'not-allowed' : 'pointer', opacity: licensesRemaining === 0 ? 0.5 : 1, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Mail size={16} />
                    {inviteLoading ? 'Sending...' : 'Send Invite'}
                  </button>
                </form>

                {inviteSuccess && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '10px 16px', color: '#15803d', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={16} />{inviteSuccess}
                  </div>
                )}
                {inviteError && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 16px', color: '#b91c1c', fontSize: 14 }}>
                    {inviteError}
                  </div>
                )}
              </div>
            )}

            {/* Invited Teachers List */}
            {license.invitedTeachers && license.invitedTeachers.length > 0 && (
              <div style={{ background: 'white', borderRadius: 16, padding: '24px', border: '1.5px solid #e5d6f8' }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e003a', marginBottom: 16 }}>Invited Teachers ({license.invitedTeachers.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {license.invitedTeachers.map((teacherEmail, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f7f2fd', borderRadius: 10, fontSize: 14 }}>
                      <CheckCircle2 size={16} color="#15803d" />
                      <span style={{ flex: 1, color: '#3b006e' }}>{teacherEmail}</span>
                      <span style={{ fontSize: 12, color: '#8c3dd4', fontWeight: 600 }}>Invited</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Switch account */}
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <button onClick={() => { setLicense(null); setEmail(''); setEmailInput(''); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
                Switch account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}