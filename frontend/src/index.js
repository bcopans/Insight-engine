import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AuthPage from './AuthPage';
import { supabase } from './supabase';

function Root() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    // Loading — show blank while checking auth
    return <div style={{ minHeight: '100vh', background: '#f0f2f5' }} />;
  }

  return session ? <App session={session} /> : <AuthPage />;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Root />);

