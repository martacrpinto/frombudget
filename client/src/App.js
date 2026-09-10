import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import LoginModal from './components/ui/LoginModal';
import Layout from './components/layout/Layout';
import NotificationStack from './components/ui/NotificationStack';

function AppInner() {
  const { currentUser } = useApp();

  return (
    <>
      {!currentUser ? <LoginModal /> : <Layout />}
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
