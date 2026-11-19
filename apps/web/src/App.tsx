import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Layout } from './Layout';
import { Activity } from './pages/Activity';
import { Assistant } from './pages/Assistant';
import { Interview } from './pages/Interview';
import { Interviews } from './pages/Interviews';
import { PostDetail } from './pages/PostDetail';
import { Posts } from './pages/Posts';
import { ReadyToPost } from './pages/ReadyToPost';
import { Draft } from './pages/Draft';
import { Home } from './pages/Home';
import { Knowledge } from './pages/Knowledge';
import { SetPassword } from './pages/SetPassword';
import { SignIn } from './pages/SignIn';
import { Staff } from './pages/Staff';
import { AuthShell, secondaryButtonClass } from './ui';

export default function App() {
  const { status, message, signOut } = useAuth();
  switch (status) {
    case 'loading':
      return (
        <AuthShell>
          <p>Loading…</p>
        </AuthShell>
      );
    case 'signed_out':
      return <SignIn />;
    case 'needs_password':
      return <SetPassword />;
    case 'no_access':
    case 'error':
      return (
        <AuthShell>
          <div className="space-y-4 rounded-lg bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <p role="alert">{message ?? 'Something went wrong.'}</p>
            <button onClick={() => void signOut()} className={secondaryButtonClass}>
              Sign out
            </button>
          </div>
        </AuthShell>
      );
    case 'ready':
      return (
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="create" element={<Draft />} />
            <Route path="posts" element={<Posts />} />
            <Route path="posts/:itemId" element={<PostDetail />} />
            <Route path="ready" element={<ReadyToPost />} />
            <Route path="activity" element={<Activity />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="interviews" element={<Interviews />} />
            <Route path="interviews/:sessionId" element={<Interview />} />
            <Route path="staff" element={<Staff />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      );
  }
}
