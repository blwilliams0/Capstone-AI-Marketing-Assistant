import { useState, useEffect, useCallback } from 'react';

type UserRole = 'admin' | 'approver' | 'contributor' | 'viewer';

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Mock auth - in production, this would use Supabase Auth
  useEffect(() => {
    const storedUser = localStorage.getItem('the-pocket-user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = useCallback((userData: User) => {
    setUser(userData);
    localStorage.setItem('the-pocket-user', JSON.stringify(userData));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('the-pocket-user');
  }, []);

  return { user, loading, login, logout };
};
