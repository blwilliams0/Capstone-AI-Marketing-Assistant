import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './hooks/useAuth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
    },
  },
});

const Login = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'approver' | 'contributor' | 'viewer'>('contributor');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({
      id: 'user-' + Date.now(),
      email: email || 'user@example.com',
      name: 'Test User',
      role: role,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold text-center mb-6">The Pocket AI Marketing Assistant</h1>
        <p className="text-gray-600 mb-6 text-center">Development Mode - Mock Authentication</p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="user@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="viewer">Viewer - Read only</option>
              <option value="contributor">Contributor - Can draft content</option>
              <option value="approver">Approver - Can approve content</option>
              <option value="admin">Admin - Full access</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Login
          </button>
        </form>

        <div className="mt-4 text-xs text-gray-500 text-center">
          <p>Use the form above to simulate different user roles.</p>
          <p className="mt-1">In production, this would use Supabase Auth.</p>
        </div>
      </div>
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const Home = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">The Pocket AI Marketing Assistant</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {user.name} ({user.role})
              </span>
              <button
                onClick={logout}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {user.role === 'admin' && (
            <div className="bg-white overflow-hidden shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900">Admin Dashboard</h3>
              <p className="mt-1 text-sm text-gray-500">Manage users, brand knowledge, and system settings.</p>
            </div>
          )}
          {['admin', 'approver'].includes(user.role) && (
            <div className="bg-white overflow-hidden shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900">Approvals</h3>
              <p className="mt-1 text-sm text-gray-500">Review and approve marketing content.</p>
            </div>
          )}
          <div className="bg-white overflow-hidden shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900">Campaigns</h3>
            <p className="mt-1 text-sm text-gray-500">Create and manage marketing campaigns.</p>
          </div>
          <div className="bg-white overflow-hidden shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900">Knowledge Base</h3>
            <p className="mt-1 text-sm text-gray-500">View and edit brand rules and verified facts.</p>
          </div>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-blue-900">System Status</h3>
          <div className="mt-2 space-y-2 text-sm text-blue-700">
            <p>? Development Mode - Mock Authentication</p>
            <p>? No real AI API calls (mocked)</p>
            <p>? No social media publishing (mocked)</p>
            <p>? Database: Local/Development</p>
          </div>
        </div>
      </main>
    </div>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
