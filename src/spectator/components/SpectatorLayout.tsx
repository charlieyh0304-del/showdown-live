import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import ErrorBoundary from '@shared/components/ErrorBoundary';

interface SpectatorLayoutProps {
  children: ReactNode;
}

export default function SpectatorLayout({ children }: SpectatorLayoutProps) {
  const navigate = useNavigate();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Skip navigation - handled by global skip-link in App.tsx */}

      {/* Header */}
      <header
        aria-label="쇼다운 관람"
        style={{
          backgroundColor: '#111827',
          borderBottom: '2px solid #374151',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={() => navigate('/spectator')}
          className="btn"
          style={{
            background: 'none',
            color: 'var(--color-secondary)',
            padding: '0.5rem 0.75rem',
            fontSize: '1.1rem',
          }}
          aria-label="관람 홈으로 이동"
        >
          ← 관람 홈
        </button>
        <span
          aria-hidden="true"
          style={{
            fontSize: '1.5rem',
            fontWeight: 'bold',
            color: 'var(--color-primary)',
          }}
        >
          쇼다운 관람
        </span>
        <div style={{ width: '60px' }} aria-hidden="true" />
      </header>

      {/* Main content area */}
      <main
        id="main-content"
        style={{
          flex: 1,
          padding: '1rem',
          paddingBottom: '5rem',
          overflowY: 'auto',
        }}
      >
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </main>

      {/* Bottom tab navigation */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#111827',
          borderTop: '2px solid #374151',
          display: 'flex',
          zIndex: 40,
        }}
        aria-label="하단 내비게이션"
      >
        <NavLink
          to="/spectator"
          end
          className={({ isActive }) =>
            isActive ? 'nav-link active' : 'nav-link'
          }
          style={{
            flex: 1,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}
          aria-label="대회 목록"
        >
          대회
        </NavLink>
        <NavLink
          to="/spectator/favorites"
          className={({ isActive }) =>
            isActive ? 'nav-link active' : 'nav-link'
          }
          style={{
            flex: 1,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}
          aria-label="즐겨찾기"
        >
          즐겨찾기
        </NavLink>
        <NavLink
          to="/spectator/practice"
          className={({ isActive }) =>
            isActive ? 'nav-link active' : 'nav-link'
          }
          style={{
            flex: 1,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            textDecoration: 'none',
            fontSize: '1.25rem',
            fontWeight: 'bold',
          }}
          aria-label="연습 경기"
        >
          연습
        </NavLink>
      </nav>
    </div>
  );
}
