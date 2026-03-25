import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface AuthGuardProps {
  requiredMode: 'admin' | 'referee';
  children: React.ReactNode;
  fallbackPath: string;
}

export default function AuthGuard({ requiredMode, children, fallbackPath }: AuthGuardProps) {
  const { session } = useAuth();

  if (!session || session.mode !== requiredMode) {
    return <Navigate to={fallbackPath} replace />;
  }

  // 8-hour session expiry
  const SESSION_TTL = 8 * 60 * 60 * 1000;
  if (Date.now() - session.authenticatedAt > SESSION_TTL) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}
