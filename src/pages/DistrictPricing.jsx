import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';

const TIERS = [
  {
    key: 'starter', label: 'Starter', name: 'Building Block', range: '1–4 teacher seats',
    minSeats: 1, maxSeats: 4,
    annualRate: 179, monthlyRate: 19,
    savings: null,
    badge: null, featured: false,
    features: [
      'Up to 10 student accounts per teacher seat',
      'PK–Grade 5 full content library',
      '4 learning modalities',
      'Teacher dashboard & progress reports',
      'iOS, Android & web access',
      'Email support',
    ],
  },
  {
    key: 'growth', label: 'Growth', name: 'Program Pack', range: '5–14 teacher seats',
    minSeats: 5, maxSeats: 14,
    annualRate: 159, monthlyRate: 17,
    savings: 'Save 11% vs. standard rate',
    badge: '⭐ Most Popular', featured: true,
    features: [
      'Everything in Building Block',
      'District admin dashboard',
      'Roster import (CSV / SIS)',
      'Aggregate reporting across classrooms',
      'Priority email & chat support',
      'Onboarding call with Modal Ed team',
    ],
  },
  {
    key: 'campus', label: 'Campus', name: 'Campus Reach', range: '15–29 teacher seats',
    minSeats: 15, maxSeats: 29,
    annualRate: 139, monthlyRate: 15,
    savings: 'Save 22% vs. standard rate',
    badge: null, featured: false,
    features: [
      'Everything in Program Pack',
      'Dedicated success manager',
      'SSO / LMS integration support',
    ],
  },
  {
    key: 'enterprise', label: 'Enterprise', name: 'District-Wide', range: '30+ teacher seats',
    minSeats: 30, maxSeats: Infinity,
    annualRate: 119, monthlyRate: 13,
    savings: 'Save 34% vs. standard rate',
    badge: 'Best Value', featured: false, enterprise: true,
    features: [
      'Everything in Campus Reach',
      'Unlimited seats — one flat rate',
      'Multi-school admin console',
      'Custom contract support',
    ],
  },
];

function getTierForSeats(seats) {
  return TIERS.find(t => seats >= t.minSeats && seats <= t.maxSeats) || TIERS[TIERS.length - 1];
}

export default function DistrictPricing() {
  const [billing, setBilling] = useState('annual');
  const [sliderSeats, setSliderSeats] = useState(10);
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  // Pre-checkout modal state
  const [showModal, setShowModal] = useState(false);
  const [pendingTier, setPendingTier] = useState(null);
  const [modalSeats, setModalSeats] = useState(10);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [districtName, setDistrictName] = useState('');

  const calcTier = useMemo(() => getTierForSeats(sliderSeats), [sliderSeats]);
  const calcRate = billing === 'annual' ? calcTier.annualRate : calcTier.monthlyRate;
  const calcTotal = calcRate * sliderSeats;
  const standardTotal = (billing === 'annual' ? 179 : 19) * sliderSeats;
  const calcSavings = standardTotal - calcTotal;

  const openCheckoutModal = (tier) => {
    setPendingTier(tier);
    // Pre-seed seats: use slider value if it's in this tier's range, else use tier min
    const preSeeds = sliderSeats >= tier.minSeats && sliderSeats <= Math.min(tier.maxSeats, 50)
      ? sliderSeats
      : tier.minSeats;
    setModalSeats(preSeeds);
    setCheckoutError('');
    setShowModal(true);
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!adminEmail || !pendingTier) return;
    setLoading(true);
    setCheckoutError('');
    try {
      const seats = modalSeats;
      const res = await base44.functions.invoke('createStripeCheckout', {
        seats,
        billing,
        adminEmail: adminEmail.toLowerCase().trim(),
        adminName: adminName.trim(),
        districtName: districtName.trim(),
        successUrl: `${window.location.origin}/DistrictAdminDashboard?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(adminEmail.toLowerCase().trim())}`,
        cancelUrl: `${window.location.origin}/DistrictPricing`,
      });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setCheckoutError('Failed to start checkout. Please try again.');
      }
    } catch (err) {
      setCheckoutError(err.message || 'Checkout error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#f7f2fd', minHeight: '100vh', color: '#1e003a' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet" />

      {/* Pre-checkout Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: 'white', borderRadius: 20, padding: '36px', maxWidth: 500, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1e003a', marginBottom: 6 }}>Almost there!</h2>
            <p style={{ color: '#4b2865', fontSize: 14, marginBottom: 24 }}>Configure your plan and we'll create your admin account.</p>
            <form onSubmit={handleCheckout} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Seat Selector */}
              {pendingTier && (() => {
                const minS = pendingTier.minSeats;
                const maxS = Math.min(pendingTier.maxSeats === Infinity ? 50 : pendingTier.maxSeats, 50);
                const modalRate = billing === 'annual' ? getTierForSeats(modalSeats).annualRate : getTierForSeats(modalSeats).monthlyRate;
                const modalTotal = modalRate * modalSeats;
                return (
                  <div style={{ background: '#f7f2fd', borderRadius: 12, padding: '16px 18px', border: '1.5px solid #d4aff5' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#520096' }}>Teacher Seats</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button type="button" onClick={() => setModalSeats(s => Math.max(minS, s - 1))}
                          style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #520096', background: 'white', color: '#520096', fontWeight: 700, fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>−</button>
                        <span style={{ fontSize: 22, fontWeight: 800, color: '#1e003a', minWidth: 32, textAlign: 'center' }}>{modalSeats}</span>
                        <button type="button" onClick={() => setModalSeats(s => Math.min(maxS, s + 1))}
                          style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #520096', background: 'white', color: '#520096', fontWeight: 700, fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                    <input type="range" min={minS} max={maxS} value={modalSeats} onChange={e => setModalSeats(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#520096', height: 6 }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 13 }}>
                      <span style={{ color: '#4b2865' }}>${modalRate}/teacher/{billing === 'annual' ? 'yr' : 'mo'}</span>
                      <span style={{ fontWeight: 800, color: '#1e003a', fontSize: 16 }}>${modalTotal.toLocaleString()} total/{billing === 'annual' ? 'yr' : 'mo'}</span>
                    </div>
                    {modalSeats >= 5 && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#15803d', fontWeight: 600 }}>🎉 Qualifies for 14-day free trial — <a href="/DistrictTrial" style={{ color: '#520096' }}>use that instead?</a></div>
                    )}
                  </div>
                );
              })()}

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#520096', display: 'block', marginBottom: 6 }}>Work Email *</label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@district.edu" required
                  style={{ width: '100%', border: '1.5px solid #d4aff5', borderRadius: 10, padding: '10px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#520096', display: 'block', marginBottom: 6 }}>Your Name</label>
                <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Jane Smith"
                  style={{ width: '100%', border: '1.5px solid #d4aff5', borderRadius: 10, padding: '10px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#520096', display: 'block', marginBottom: 6 }}>School / District Name</label>
                <input type="text" value={districtName} onChange={e => setDistrictName(e.target.value)} placeholder="Springfield Unified School District"
                  style={{ width: '100%', border: '1.5px solid #d4aff5', borderRadius: 10, padding: '10px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {checkoutError && <p style={{ color: '#dc2626', fontSize: 13 }}>{checkoutError}</p>}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, background: 'white', color: '#520096', border: '2px solid #520096', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  style={{ flex: 2, background: '#520096', color: 'white', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  {loading ? 'Redirecting...' : `Pay $${(billing === 'annual' ? getTierForSeats(modalSeats).annualRate : getTierForSeats(modalSeats).monthlyRate) * modalSeats} →`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #1e003a 0%, #520096 60%, #8c3dd4 100%)', color: 'white', padding: '72px 24px 60px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: 999, padding: '6px 18px', fontSize: 14, fontWeight: 600, marginBottom: 20, letterSpacing: '0.04em' }}>
          🏫 School & District Purchasing
        </div>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 400, marginBottom: 16, lineHeight: 1.15 }}>
          Math Practice That Works<br /><em>for More Students</em>
        </h1>
        <p style={{ fontSize: 'clamp(1rem, 2.5vw, 1.2rem)', color: '#e8d9ff', maxWidth: 620, margin: '0 auto 32px' }}>
          Modal Math delivers PreK–Grade 5 math practice across multiple learning modalities — sign language, voice, visuals, and text — so more students can engage and practice at their level.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 36 }}>
          {['🤟 Sign Language', '🗣️ Voice', '👁️ Visuals', '📝 Text', '✅ Common Core Aligned'].map(m => (
            <span key={m} style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 999, padding: '6px 16px', fontSize: 14, fontWeight: 500 }}>{m}</span>
          ))}
        </div>
        <a
          href="https://www.modalmath.com/growth"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: 'rgba(255,255,255,0.12)',
            border: '1.5px solid rgba(255,255,255,0.35)',
            borderRadius: 12,
            padding: '14px 28px',
            color: 'white',
            fontWeight: 700,
            fontSize: 16,
            textDecoration: 'none',
            backdropFilter: 'blur(4px)',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
        >
          <span style={{ fontSize: 20 }}>📈</span>
          See the Student Growth Data
          <span style={{ opacity: 0.75, fontSize: 14 }}>→</span>
        </a>
        <p style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}>Real outcomes from real classrooms</p>
      </section>

      {/* Purchase Order Notice */}
      <div style={{ background: '#fff8e6', borderTop: '3px solid #c98a00', padding: '14px 24px', textAlign: 'center', fontSize: 14, color: '#7a5100', fontWeight: 500 }}>
        ⚠️ Purchase orders are not currently accepted. All purchases are processed by credit/debit card. Questions? Email <a href="mailto:contact@modalmath.com" style={{ color: '#520096', textDecoration: 'underline' }}>contact@modalmath.com</a>
      </div>

      {/* Pricing Section */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '60px 24px 0' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8c3dd4', marginBottom: 8 }}>District Pricing</div>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 400, marginBottom: 12 }}>Per-Teacher Seat Licensing</h2>
          <p style={{ color: '#4b2865', fontSize: 16, maxWidth: 560, margin: '0 auto 28px' }}>All plans include up to 10 student accounts per teacher seat. Volume discounts apply automatically.</p>

          {/* Billing Toggle */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, background: 'white', borderRadius: 999, padding: '8px 20px', boxShadow: '0 2px 8px rgba(82,0,150,0.12)' }} role="group" aria-label="Billing frequency">
            <button onClick={() => setBilling('annual')} aria-pressed={billing === 'annual'}
              style={{ fontWeight: 600, color: billing === 'annual' ? '#520096' : '#595959', cursor: 'pointer', background: 'none', border: 'none', fontSize: 16, padding: 0 }}>Annual</button>
            <button
              onClick={() => setBilling(b => b === 'annual' ? 'monthly' : 'annual')}
              role="switch"
              aria-checked={billing === 'monthly'}
              aria-label="Toggle billing frequency"
              style={{ width: 44, height: 24, borderRadius: 999, background: billing === 'monthly' ? '#520096' : '#6b3a8a', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', border: 'none', padding: 0 }}>
              <span style={{ width: 18, height: 18, background: 'white', borderRadius: '50%', position: 'absolute', top: 3, left: billing === 'monthly' ? 23 : 3, transition: 'left 0.2s', display: 'block' }} />
            </button>
            <button onClick={() => setBilling('monthly')} aria-pressed={billing === 'monthly'}
              style={{ fontWeight: 600, color: billing === 'monthly' ? '#520096' : '#595959', cursor: 'pointer', background: 'none', border: 'none', fontSize: 16, padding: 0 }}>Monthly</button>
            <span style={{ background: '#ede0fb', color: '#3d006e', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>Save up to 17% annually</span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 20, marginBottom: 60 }}>
          {TIERS.map(tier => {
            const rate = billing === 'annual' ? tier.annualRate : tier.monthlyRate;
            const isEnterprise = tier.key === 'enterprise';
            return (
              <div key={tier.key} style={{
                background: 'white',
                borderRadius: 20,
                padding: '28px 24px',
                border: tier.featured ? '2.5px solid #520096' : '1.5px solid #e5d6f8',
                boxShadow: tier.featured ? '0 8px 32px rgba(82,0,150,0.15)' : '0 2px 8px rgba(82,0,150,0.06)',
                position: 'relative',
                display: 'flex', flexDirection: 'column',
              }}>
                {tier.badge && (
                  <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: tier.featured ? '#520096' : '#c98a00', color: 'white', fontSize: 12, fontWeight: 700, padding: '4px 14px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                    {tier.badge}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8c3dd4', marginBottom: 4 }}>{tier.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1e003a', marginBottom: 4 }}>{tier.name}</div>
                <div style={{ fontSize: 13, color: '#6b0fbb', marginBottom: 16, fontWeight: 500 }}>{tier.range}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: '#520096', lineHeight: 1.4 }}>$</span>
                  <span style={{ fontSize: 42, fontWeight: 800, color: '#1e003a', lineHeight: 1 }}>{rate}</span>
                  <span style={{ fontSize: 13, color: '#595959', lineHeight: 1.3 }}>/teacher<br />{billing === 'annual' ? 'per year' : 'per month'}</span>
                </div>
                {tier.savings && <div style={{ fontSize: 12, color: '#520096', fontWeight: 600, marginBottom: 4 }}>{tier.savings}</div>}
                <hr style={{ border: 'none', borderTop: '1px solid #ede0fb', margin: '16px 0' }} />
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', flex: 1 }}>
                  {tier.features.map(f => (
                    <li key={f} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 14, color: '#3b006e' }}>
                      <span style={{ color: '#520096', fontWeight: 700, flexShrink: 0 }}>✓</span>{f}
                    </li>
                  ))}
                </ul>
                {isEnterprise ? (
                  <a href="mailto:contact@modalmath.com" style={{ display: 'block', textAlign: 'center', background: '#1e003a', color: 'white', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
                    Contact for Pricing
                  </a>
                ) : (
                  <button
                    onClick={() => openCheckoutModal(tier)}
                    disabled={loading}
                    style={{ background: tier.featured ? '#520096' : 'white', color: tier.featured ? 'white' : '#520096', border: '2px solid #520096', borderRadius: 10, padding: '12px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%' }}
                  >
                    Get Started
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Calculator */}
      <div style={{ background: 'white', padding: '60px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8c3dd4', marginBottom: 8 }}>Savings Calculator</div>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', fontWeight: 400 }}>See What Your District Saves</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: '#1e003a', marginBottom: 10 }}>How many teacher seats does your program need?</h3>
              <p style={{ color: '#4b2865', fontSize: 15, marginBottom: 24 }}>Adjust the slider to see your tier, annual total, and savings.</p>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#520096', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>Teacher Seats</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#1e003a' }}>{sliderSeats} seats</span>
              </label>
              <input type="range" min="1" max="50" value={sliderSeats} onChange={e => setSliderSeats(Number(e.target.value))}
                aria-label={`Teacher seats: ${sliderSeats}`}
                aria-valuemin={1} aria-valuemax={50} aria-valuenow={sliderSeats}
                style={{ width: '100%', accentColor: '#520096', height: 6 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#595959', marginTop: 4 }} aria-hidden="true">
                <span>1</span><span>50</span>
              </div>
            </div>
            <div style={{ background: '#f7f2fd', borderRadius: 16, padding: 28, border: '1.5px solid #e5d6f8' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#8c3dd4', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Your Estimated Plan</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e003a', marginBottom: 16 }}>{calcTier.name}</div>
              {[
                ['Seats', sliderSeats],
                ['Per-seat rate', `$${calcRate}/${billing === 'annual' ? 'yr' : 'mo'}`],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e5d6f8', fontSize: 15 }}>
                  <span style={{ color: '#4b2865' }}>{label}</span>
                  <span style={{ fontWeight: 700, color: '#1e003a' }}>{val}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: calcSavings > 0 ? '1px solid #e5d6f8' : 'none', marginTop: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#1e003a' }}>Total</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#1e003a' }}>${calcTotal.toLocaleString()}<span style={{ fontSize: 13, fontWeight: 500, color: '#595959' }}>/{billing === 'annual' ? 'yr' : 'mo'}</span></span>
              </div>
              {calcSavings > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ fontSize: 13, color: '#520096', fontWeight: 600 }}>You save vs. standard rate</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#520096', background: '#ede0fb', borderRadius: 999, padding: '2px 10px' }}>${calcSavings.toLocaleString()}/yr</span>
                </div>
              )}
              {sliderSeats >= 5 && (
                <div style={{ marginTop: 16, background: '#ede0fb', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#520096', fontWeight: 600 }}>
                  🎉 Your district qualifies for a <strong>14-day free trial</strong> — no commitment required!
                  <div style={{ marginTop: 8 }}>
                    <Link to={createPageUrl('DistrictTrial')} style={{ color: '#520096', textDecoration: 'underline', fontWeight: 700 }}>Start Free Trial →</Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Free Trial CTA Banner */}
      <div style={{ background: 'linear-gradient(135deg, #520096, #8c3dd4)', padding: '48px 24px', textAlign: 'center', color: 'white' }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#d4b8f5', marginBottom: 10 }}>Districts with 5+ Teachers</div>
        <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)', fontWeight: 400, marginBottom: 14, color: 'white' }}>Try Modal Math Free for 14 Days</h2>
        <p style={{ fontSize: 16, maxWidth: 520, margin: '0 auto 28px', color: '#f0e6ff' }}>No commitment, no credit card required. Experience the full platform with your team before purchasing.</p>
        <Link to={createPageUrl('DistrictTrial')} style={{ display: 'inline-block', background: 'white', color: '#520096', borderRadius: 10, padding: '14px 36px', fontWeight: 700, fontSize: 16, textDecoration: 'none' }}>
          Start 14-Day Free Trial
        </Link>
      </div>

      {/* Footer Note */}
      <div style={{ padding: '32px 24px', textAlign: 'center', background: '#f7f2fd', fontSize: 13, color: '#4b2865' }}>
        <p>Questions about district pricing or licensing? Email us at <a href="mailto:contact@modalmath.com" style={{ color: '#520096', fontWeight: 600 }}>contact@modalmath.com</a></p>
        <p style={{ marginTop: 8, color: '#6b3a8a' }}>⚠️ Purchase orders are not currently accepted for the time being.</p>
      </div>
    </div>
  );
}