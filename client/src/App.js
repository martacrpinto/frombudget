import React, { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!supabase) return undefined;
    const hydratePasswordFlag = async () => {
      const { data } = await supabase.auth.getSession();
      setMustChangePassword(Boolean(data.session?.user?.app_metadata?.must_change_password));
    };
    hydratePasswordFlag();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordAction(true);
      setMustChangePassword(Boolean(session?.user?.app_metadata?.must_change_password));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const profileRequiresPassword = Boolean(currentUser?.must_change_password || currentUser?.mustChangePassword);
  const requiresPasswordChange = mustChangePassword || profileRequiresPassword;

  return (
    <>
      {!currentUser || passwordAction ? (
        <LoginModal
          forcePasswordAction={passwordAction}
          onPasswordActionFinished={() => setPasswordAction(false)}
        />
      ) : requiresPasswordChange ? (
        <FirstLoginPasswordModal onPasswordChanged={() => setMustChangePassword(false)} />
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
