import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { CheckCircle2 } from 'lucide-react';

export default function DistrictTrial() {
  const [form, setForm] = useState({ adminEmail: '', adminName: '', adminTitle: '', districtName: '', seats: 5 });
  const TRIAL_SEATS = 5;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await base44.functions.invoke('startDistrictTrial', {
        adminEmail: form.adminEmail,
        adminName: form.adminName,
        adminTitle: form.adminTitle,
        districtName: form.districtName,
        seats: TRIAL_SEATS,
      });
      if (res.data?.success) {
        setSuccess(true);
        setTimeout(() => navigate(createPageUrl('DistrictAdminDashboard') + `?email=${encodeURIComponent(form.adminEmail)}`), 3000);
      } else {
        setError(res.data?.error || 'Something went wrong. Please try again.');
      }
    } catch (err) {
      setError(err.message || 'Failed to start trial.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', background: '#f7f2fd', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ width: 72, height: 72, background: '#ede0fb', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircle2 size={36} color="#520096" />
          </div>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: '2rem', color: '#1e003a', marginBottom: 12 }}>Trial Started!</h1>
          <p style={{ color: '#4b2865', fontSize: 16 }}>Check your email for confirmation. Redirecting to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', background: '#f7f2fd', color: '#1e003a' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e003a 0%, #520096 100%)', padding: '48px 24px 40px', textAlign: 'center', color: 'white' }}>
        <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: 999, padding: '5px 16px', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          🎉 Includes 5 Teacher Seats
        </div>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 400, marginBottom: 12 }}>Start Your 14-Day Free Trial</h1>
        <p style={{ opacity: 0.9, fontSize: 16, maxWidth: 500, margin: '0 auto' }}>No credit card required. No commitment. Try Modal Math with 5 teachers for 14 days.</p>
      </div>

      {/* What's included */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px 0' }}>
        <div style={{ background: 'white', borderRadius: 20, padding: '28px 32px', border: '1.5px solid #e5d6f8', marginBottom: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[
            '✓ Full PK–Grade 5 content library',
            '✓ All 4 learning modalities',
            '✓ Teacher dashboard & reports',
            '✓ District admin dashboard',

            '✓ No credit card required',
          ].map(f => (
            <div key={f} style={{ fontSize: 14, color: '#3b006e', fontWeight: 500 }}>{f}</div>
          ))}
        </div>

        {/* Form */}
        <div style={{ background: 'white', borderRadius: 20, padding: '36px', border: '1.5px solid #e5d6f8', maxWidth: 560, margin: '0 auto 40px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e003a', marginBottom: 24 }}>Set Up Your Trial</h2>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {[
              { key: 'adminName', label: 'Your Full Name', type: 'text', placeholder: 'Jane Smith', required: true },
              { key: 'adminTitle', label: 'Your Title', type: 'text', placeholder: 'Curriculum Director', required: true },
              { key: 'adminEmail', label: 'Your Email Address', type: 'email', placeholder: 'jane@district.edu', required: true },
              { key: 'districtName', label: 'School / District Name', type: 'text', placeholder: 'Springfield USD', required: true },
            ].map(({ key, label, type, placeholder, required }) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#520096', marginBottom: 6 }}>{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  required={required}
                  style={{ width: '100%', border: '1.5px solid #d4aff5', borderRadius: 10, padding: '10px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box', background: '#faf8ff' }}
                />
              </div>
            ))}

            <div style={{ background: '#f7f2fd', border: '1.5px solid #d4aff5', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#3b006e', fontWeight: 500 }}>
              🎓 Free trial includes <strong>5 teacher seats</strong>. Need more? <Link to={createPageUrl('DistrictPricing')} style={{ color: '#520096' }}>View paid plans →</Link>
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', fontSize: 14 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ background: '#520096', color: 'white', border: 'none', borderRadius: 10, padding: '14px 0', fontSize: 16, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Starting Trial...' : 'Start Free Trial — No Card Required'}
            </button>

            <p style={{ textAlign: 'center', fontSize: 13, color: '#888' }}>
              Already purchased? <Link to={createPageUrl('DistrictAdminDashboard')} style={{ color: '#520096', fontWeight: 600 }}>Go to Dashboard →</Link>
            </p>
          </form>
        </div>

        <div style={{ textAlign: 'center', paddingBottom: 40 }}>
          <Link to={createPageUrl('DistrictPricing')} style={{ color: '#520096', fontSize: 14, textDecoration: 'underline' }}>← Back to Pricing</Link>
          <p style={{ marginTop: 12, fontSize: 13, color: '#888' }}>Questions? <a href="mailto:contact@modalmath.com" style={{ color: '#520096' }}>contact@modalmath.com</a></p>
        </div>
      </div>
    </div>
  );
}