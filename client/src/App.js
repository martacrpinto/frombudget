import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import LoginModal from './components/ui/LoginModal';
import Layout from './components/layout/Layout';
import NotificationStack from './components/ui/NotificationStack';
import { isPasswordActionUrl, supabase } from './lib/supabase';

function AppInner() {
  const { currentUser } = useApp();
  const [passwordAction, setPasswordAction] = useState(isPasswordActionUrl);

  useEffect(() => {
    if (!supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordAction(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <>
      {!currentUser || passwordAction ? (
        <LoginModal
          forcePasswordAction={passwordAction}
          onPasswordActionFinished={() => setPasswordAction(false)}
        />
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
