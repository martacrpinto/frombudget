import React, { useCallback, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import LoginModal from './components/ui/LoginModal';
import Layout from './components/layout/Layout';
import NotificationStack from './components/ui/NotificationStack';
import { isPasswordActionUrl, supabase } from './lib/supabase';
import FirstLoginPasswordModal from './components/ui/FirstLoginPasswordModal';

function AppInner() {
  const { currentUser } = useApp();
  const [passwordAction, setPasswordAction] = useState(isPasswordActionUrl);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [passwordChangeResolved, setPasswordChangeResolved] = useState(false);
  const handlePasswordChanged = useCallback(() => {
    setMustChangePassword(false);
    setPasswordChangeResolved(true);
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;
    const hydratePasswordFlag = async () => {
      const { data } = await supabase.auth.getSession();
      let session = data.session;
      if (session?.user?.app_metadata?.must_change_password === true) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session || session;
      }
      if (alive) setMustChangePassword(Boolean(session?.user?.app_metadata?.must_change_password));
    };
    hydratePasswordFlag();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordAction(true);
      setMustChangePassword(Boolean(session?.user?.app_metadata?.must_change_password));
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const profileRequiresPassword = !passwordChangeResolved
    && Boolean(currentUser?.must_change_password || currentUser?.mustChangePassword);
  const requiresPasswordChange = mustChangePassword || profileRequiresPassword;

  return (
    <>
      {!currentUser || passwordAction ? (
        <LoginModal
          forcePasswordAction={passwordAction}
          onPasswordActionFinished={() => setPasswordAction(false)}
        />
      ) : requiresPasswordChange ? (
        <FirstLoginPasswordModal onPasswordChanged={handlePasswordChanged} />
      ) : <Layout />}
      <NotificationStack />
    </>
  );
}

function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}

export default App;
