import { useNavigate } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import { useAuthStore } from '@/stores'
import styles from './AdminHome.module.css'

export function AdminHome() {
  const navigate = useNavigate()
  const currentOperator = useAuthStore((state) => state.currentOperator)

  return (
    <div className={styles.container}>
      <Header
        title="관리자 모드"
        subtitle="대회 생성 및 관리"
        gradient="linear-gradient(135deg, #fbbc04 0%, #ea4335 100%)"
        showBack
        onBack={() => navigate('/')}
      />

      <main>
        {currentOperator && (
          <Card>
            <div className={styles.operatorInfo}>
              <span className={styles.operatorIcon}>👤</span>
              <div>
                <strong>{currentOperator.name}</strong>
                <span className={styles.role}>
                  {currentOperator.role === 'super' ? '슈퍼 관리자' : '관리자'}
                </span>
              </div>
            </div>
          </Card>
        )}

        <section>
          <Card title="대회 관리">
            <Button
              variant="primary"
              onClick={() => navigate('/admin/projects')}
            >
              📋 대회 목록
            </Button>
            <Button
              variant="success"
              onClick={() => navigate('/admin/create-project')}
            >
              ➕ 새 대회 만들기
            </Button>
          </Card>
        </section>

        <section>
          <Card title="브라켓 관리">
            <Button onClick={() => navigate('/admin/bracket')}>
              🏆 토너먼트 브라켓
            </Button>
          </Card>
        </section>

        <section>
          <Card title="인력 관리">
            <Button onClick={() => navigate('/admin/referees')}>
              🏅 심판 관리
            </Button>
            <Button onClick={() => navigate('/admin/courts')}>
              🏟️ 코트 관리
            </Button>
          </Card>
        </section>

        <section>
          <Card title="설정">
            <Button onClick={() => navigate('/admin/settings')}>
              ⚙️ 관리자 설정
            </Button>
            <Button onClick={() => navigate('/admin/operators')}>
              👥 운영자 설정
            </Button>
          </Card>
        </section>
      </main>
    </div>
  )
}
