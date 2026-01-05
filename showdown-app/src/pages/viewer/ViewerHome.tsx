import { useNavigate } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import styles from './ViewerHome.module.css'

export function ViewerHome() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <Header
        title="관람 모드"
        subtitle="실시간 경기 현황 확인"
        gradient="linear-gradient(135deg, #4285f4 0%, #34a853 100%)"
        showBack
        onBack={() => navigate('/')}
      />

      <main>
        <section>
          <Card title="실시간 경기">
            <Button onClick={() => navigate('/viewer/live-practice')}>
              🔴 실시간 연습 경기
            </Button>
          </Card>
        </section>

        <section>
          <Card title="대회 정보">
            <Button onClick={() => navigate('/viewer/projects')}>
              📋 대회 목록
            </Button>
            <Button onClick={() => navigate('/viewer/results')}>
              🏆 대회 결과
            </Button>
          </Card>
        </section>

        <section>
          <Card title="일정 조회">
            <Button onClick={() => navigate('/viewer/player-schedule')}>
              👤 선수별 일정
            </Button>
            <Button onClick={() => navigate('/viewer/referee-schedule')}>
              🏅 심판별 일정
            </Button>
            <Button onClick={() => navigate('/viewer/schedule-overview')}>
              📅 전체 일정
            </Button>
          </Card>
        </section>

        <section>
          <Card title="기타">
            <Button onClick={() => navigate('/viewer/match-list')}>
              🔍 경기 검색
            </Button>
            <Button onClick={() => navigate('/viewer/simulation-results')}>
              📊 시뮬레이션 결과
            </Button>
          </Card>
        </section>
      </main>
    </div>
  )
}
