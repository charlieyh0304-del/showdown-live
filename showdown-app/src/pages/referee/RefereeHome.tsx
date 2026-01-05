import { useNavigate } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import styles from './RefereeHome.module.css'

export function RefereeHome() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <Header
        title="심판 모드"
        subtitle="경기 진행 및 점수 기록"
        gradient="linear-gradient(135deg, #34a853 0%, #0d652d 100%)"
        showBack
        onBack={() => navigate('/')}
      />

      <main>
        <section>
          <Card title="대회 경기">
            <Button
              variant="primary"
              onClick={() => navigate('/referee/projects')}
            >
              📋 대회/경기 목록
            </Button>
          </Card>
        </section>

        <section>
          <Card title="연습 경기">
            <Button
              variant="success"
              onClick={() => navigate('/referee/practice')}
            >
              🏓 새 연습 경기
            </Button>
            <Button onClick={() => navigate('/referee/practice-history')}>
              📜 연습 경기 기록
            </Button>
          </Card>
        </section>

        <section>
          <Card title="내 일정">
            <Button onClick={() => navigate('/referee/schedule')}>
              📅 심판 일정 확인
            </Button>
          </Card>
        </section>
      </main>
    </div>
  )
}
