import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useUIStore } from '@/stores'
import { useFirebase, processOfflineQueue } from '@/hooks'
import { OfflineIndicator, LoadingSpinner } from '@/components/common'

// Pages
import { Home } from '@/pages/Home'
import { ViewerHome } from '@/pages/viewer/ViewerHome'
import { RefereeHome } from '@/pages/referee/RefereeHome'
import { AdminHome } from '@/pages/admin/AdminHome'
import { CreateProject } from '@/pages/admin/CreateProject'
import { ProjectList } from '@/pages/admin/ProjectList'
import { ProjectDetail } from '@/pages/admin/ProjectDetail'
import { Match } from '@/pages/referee/Match'

// Placeholder component for routes not yet implemented
function ComingSoon({ title }: { title: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h1>{title}</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 16 }}>
        이 페이지는 준비 중입니다.
      </p>
      <button
        onClick={() => window.history.back()}
        style={{
          marginTop: 24,
          padding: '12px 24px',
          background: 'var(--primary)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          cursor: 'pointer',
        }}
      >
        뒤로 가기
      </button>
    </div>
  )
}

function App() {
  const setIsOffline = useUIStore((state) => state.setIsOffline)
  const { isLoading } = useFirebase()

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      // Process offline queue when coming back online
      processOfflineQueue()
    }
    const handleOffline = () => setIsOffline(true)

    setIsOffline(!navigator.onLine)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setIsOffline])

  // Show loading screen while initializing
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <LoadingSpinner size="large" text="앱을 불러오는 중..." />
      </div>
    )
  }

  return (
    <BrowserRouter basename="/showdown-test">
      <OfflineIndicator />
      <Routes>
        {/* Home */}
        <Route path="/" element={<Home />} />

        {/* Viewer Mode */}
        <Route path="/viewer" element={<ViewerHome />} />
        <Route path="/viewer/live-practice" element={<ComingSoon title="실시간 연습 경기" />} />
        <Route path="/viewer/projects" element={<ComingSoon title="대회 목록" />} />
        <Route path="/viewer/results" element={<ComingSoon title="대회 결과" />} />
        <Route path="/viewer/player-schedule" element={<ComingSoon title="선수별 일정" />} />
        <Route path="/viewer/referee-schedule" element={<ComingSoon title="심판별 일정" />} />
        <Route path="/viewer/schedule-overview" element={<ComingSoon title="전체 일정" />} />
        <Route path="/viewer/match-list" element={<ComingSoon title="경기 검색" />} />
        <Route path="/viewer/simulation-results" element={<ComingSoon title="시뮬레이션 결과" />} />

        {/* Referee Mode */}
        <Route path="/referee" element={<RefereeHome />} />
        <Route path="/referee/projects" element={<ComingSoon title="대회/경기 목록" />} />
        <Route path="/referee/practice" element={<ComingSoon title="새 연습 경기" />} />
        <Route path="/referee/practice-history" element={<ComingSoon title="연습 경기 기록" />} />
        <Route path="/referee/schedule" element={<ComingSoon title="심판 일정" />} />
        <Route path="/referee/match/:id" element={<Match />} />

        {/* Admin Mode */}
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/projects" element={<ProjectList />} />
        <Route path="/admin/create-project" element={<CreateProject />} />
        <Route path="/admin/project/:id" element={<ProjectDetail />} />
        <Route path="/admin/bracket" element={<ComingSoon title="토너먼트 브라켓" />} />
        <Route path="/admin/referees" element={<ComingSoon title="심판 관리" />} />
        <Route path="/admin/courts" element={<ComingSoon title="코트 관리" />} />
        <Route path="/admin/settings" element={<ComingSoon title="관리자 설정" />} />
        <Route path="/admin/operators" element={<ComingSoon title="운영자 설정" />} />

        {/* Tournament */}
        <Route path="/tournament/wizard" element={<ComingSoon title="대회 마법사" />} />
        <Route path="/tournament/teams/:id" element={<ComingSoon title="팀 관리" />} />
        <Route path="/tournament/players/:id" element={<ComingSoon title="선수 관리" />} />
        <Route path="/tournament/groups/:id" element={<ComingSoon title="조 관리" />} />
        <Route path="/tournament/bracket/:id" element={<ComingSoon title="브라켓 관리" />} />
        <Route path="/tournament/standings/:id" element={<ComingSoon title="순위표" />} />
        <Route path="/tournament/statistics/:id" element={<ComingSoon title="통계" />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
