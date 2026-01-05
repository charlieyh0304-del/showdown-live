import { useNavigate } from 'react-router-dom'
import { Header, Card } from '@/components/common'
import { useProjectStore } from '@/stores'
import styles from './ViewerProjects.module.css'

export function ViewerProjects() {
  const navigate = useNavigate()
  const projects = useProjectStore((state) => state.projects)

  // Sort by date (most recent first)
  const sortedProjects = [...projects].sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  // Get match stats for each project
  const getProjectStats = (project: typeof projects[0]) => {
    const matches = project.matches || []
    const total = matches.length
    const completed = matches.filter(m => m.status === 'completed').length
    const active = matches.filter(m => m.status === 'active').length
    return { total, completed, active }
  }

  return (
    <div className={styles.container}>
      <Header
        title="대회 목록"
        subtitle="관람할 대회를 선택하세요"
        gradient="linear-gradient(135deg, #4285f4 0%, #34a853 100%)"
        showBack
        onBack={() => navigate('/viewer')}
      />

      <main>
        {sortedProjects.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>등록된 대회가 없습니다.</p>
            </div>
          </Card>
        ) : (
          sortedProjects.map((project) => {
            const stats = getProjectStats(project)
            const isTeam = project.competitionType === 'team'

            return (
              <Card
                key={project.id}
                className={styles.projectCard}
                onClick={() => navigate(`/viewer/project/${project.id}`)}
              >
                <div className={styles.projectHeader}>
                  <h3 className={styles.projectName}>{project.name}</h3>
                  {stats.active > 0 && (
                    <span className={styles.liveBadge}>LIVE</span>
                  )}
                </div>

                <div className={styles.projectMeta}>
                  <span>{project.date}</span>
                  <span>{project.location || '장소 미정'}</span>
                  <span>{isTeam ? '팀전' : '개인전'}</span>
                </div>

                <div className={styles.projectStats}>
                  <div className={styles.statItem}>
                    <span className={styles.statValue}>{stats.completed}</span>
                    <span className={styles.statLabel}>완료</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={`${styles.statValue} ${stats.active > 0 ? styles.active : ''}`}>
                      {stats.active}
                    </span>
                    <span className={styles.statLabel}>진행중</span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statValue}>{stats.total - stats.completed - stats.active}</span>
                    <span className={styles.statLabel}>대기</span>
                  </div>
                </div>

                <div className={styles.projectActions}>
                  <span className={styles.viewMore}>자세히 보기 →</span>
                </div>
              </Card>
            )
          })
        )}
      </main>
    </div>
  )
}
