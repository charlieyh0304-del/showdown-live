import { useNavigate } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import { useAuthStore } from '@/stores'
import styles from './Home.module.css'

export function Home() {
  const navigate = useNavigate()
  const setUserRole = useAuthStore((state) => state.setUserRole)

  const handleSelectMode = (mode: 'viewer' | 'referee' | 'admin') => {
    setUserRole(mode)
    navigate(`/${mode}`)
  }

  return (
    <div className={styles.container}>
      <Header
        title="쇼다운 심판 앱 PRO"
        subtitle="대진 설정 · 심판 관리 · 실시간 점수"
        gradient="linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)"
      />

      <main>
        <nav className={styles.modeNavigation} aria-label="모드 선택">
          <ul>
            <li>
              <Card>
                <Button
                  variant="primary"
                  onClick={() => handleSelectMode('viewer')}
                  aria-describedby="viewer-desc"
                >
                  <span className={styles.modeIcon}>👀</span>
                  관람 모드
                </Button>
                <p id="viewer-desc" className={styles.modeDescription}>
                  실시간 경기 현황, 일정, 결과를 확인합니다
                </p>
              </Card>
            </li>

            <li>
              <Card>
                <Button
                  variant="success"
                  onClick={() => handleSelectMode('referee')}
                  aria-describedby="referee-desc"
                >
                  <span className={styles.modeIcon}>🏅</span>
                  심판 모드
                </Button>
                <p id="referee-desc" className={styles.modeDescription}>
                  경기 진행 및 점수를 기록합니다
                </p>
              </Card>
            </li>

            <li>
              <Card>
                <Button
                  variant="warning"
                  onClick={() => handleSelectMode('admin')}
                  aria-describedby="admin-desc"
                >
                  <span className={styles.modeIcon}>⚙️</span>
                  관리자 모드
                </Button>
                <p id="admin-desc" className={styles.modeDescription}>
                  대회 생성, 대진 설정, 심판 관리를 합니다
                </p>
              </Card>
            </li>
          </ul>
        </nav>
      </main>

      <footer className={styles.footer}>
        <p>버전 2.0.0 | React + TypeScript</p>
      </footer>
    </div>
  )
}
