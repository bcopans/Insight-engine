import { useState } from 'react';
import { supabase } from './supabase';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // login | signup | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setError(''); setMessage(''); setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Check your email to confirm your account, then log in.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMessage('Password reset email sent. Check your inbox.');
        setMode('login');
      }
    } catch (e) {
      setError(e.message || 'Something went wrong');
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };

  const onKey = (e) => { if (e.key === 'Enter') handleSubmit(); };

  return (
    <div style={{
      minHeight: '100vh', background: '#f0f2f5',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, -apple-system, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 40px 36px',
        width: 400, boxShadow: '0 4px 24px rgba(16,24,40,.10)',
        border: '1px solid #e4e7ec',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ width: 32, height: 32, background: '#2563eb', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800 }}>IE</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#101828' }}>Insight Engine</div>
            <div style={{ fontSize: 11, color: '#98a2b3', marginTop: 1 }}>User Research Intelligence</div>
          </div>
        </div>

        {/* Title */}
        <div style={{ fontSize: 22, fontWeight: 700, color: '#101828', marginBottom: 4 }}>
          {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create an account' : 'Reset password'}
        </div>
        <div style={{ fontSize: 13, color: '#98a2b3', marginBottom: 24 }}>
          {mode === 'login' ? 'Sign in to your workspace' : mode === 'signup' ? 'Get started with your own workspace' : 'We\'ll send you a reset link'}
        </div>

        {/* Google OAuth */}
        {mode !== 'reset' && (
          <>
            <button onClick={handleGoogle} style={{
              width: '100%', padding: '10px 16px', borderRadius: 8,
              border: '1px solid #d0d5dd', background: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontSize: 14, fontWeight: 600, color: '#344054',
              marginBottom: 16, transition: 'all .15s',
            }}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58Z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: '#e4e7ec' }} />
              <span style={{ fontSize: 12, color: '#98a2b3' }}>or</span>
              <div style={{ flex: 1, height: 1, background: '#e4e7ec' }} />
            </div>
          </>
        )}

        {/* Email */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#344054', display: 'block', marginBottom: 5 }}>Email</label>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKey}
            placeholder="you@company.com"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 14, color: '#101828', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#2563eb'}
            onBlur={e => e.target.style.borderColor = '#d0d5dd'}
          />
        </div>

        {/* Password */}
        {mode !== 'reset' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#344054', display: 'block', marginBottom: 5 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={onKey}
              placeholder={mode === 'signup' ? 'Min 6 characters' : '••••••••'}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 14, color: '#101828', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = '#2563eb'}
              onBlur={e => e.target.style.borderColor = '#d0d5dd'}
            />
          </div>
        )}

        {/* Error / message */}
        {error && <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626', marginBottom: 14 }}>{error}</div>}
        {message && <div style={{ padding: '8px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: 13, color: '#16a34a', marginBottom: 14 }}>{message}</div>}

        {/* Submit */}
        <button onClick={handleSubmit} disabled={loading || !email || (mode !== 'reset' && !password)} style={{
          width: '100%', padding: '11px 16px', borderRadius: 8, border: 'none',
          background: loading || !email ? '#bfdbfe' : '#2563eb',
          color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading || !email ? 'not-allowed' : 'pointer',
          marginBottom: 16, fontFamily: 'inherit',
        }}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>

        {/* Footer links */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475467' }}>
          {mode === 'login' && (
            <>
              <button onClick={() => { setMode('signup'); setError(''); setMessage(''); }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Create account</button>
              <button onClick={() => { setMode('reset'); setError(''); setMessage(''); }} style={{ background: 'none', border: 'none', color: '#98a2b3', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Forgot password?</button>
            </>
          )}
          {mode === 'signup' && (
            <button onClick={() => { setMode('login'); setError(''); setMessage(''); }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Already have an account? Sign in</button>
          )}
          {mode === 'reset' && (
            <button onClick={() => { setMode('login'); setError(''); setMessage(''); }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}
