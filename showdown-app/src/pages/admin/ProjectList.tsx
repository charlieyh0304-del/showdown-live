import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header, Card, Button, Input } from '@/components/common'
import { useProjectStore } from '@/stores'
import styles from './ProjectList.module.css'

export function ProjectList() {
  const navigate = useNavigate()
  const projects = useProjectStore((state) => state.projects)
  const setCurrentProject = useProjectStore((state) => state.setCurrentProject)
  const [searchQuery, setSearchQuery] = useState('')

  // Filter projects
  const filteredProjects = searchQuery
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.date && p.date.includes(searchQuery)) ||
        (p.location && p.location.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : projects

  // Sort by date (newest first)
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const handleProjectClick = (projectId: number) => {
    const project = projects.find((p) => p.id === projectId)
    if (project) {
      setCurrentProject(project)
      navigate(`/admin/project/${projectId}`)
    }
  }

  const getTournamentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'free': '자유 경기',
      'group': '조별 리그',
      'tournament': '토너먼트',
      'group-tournament': '조별+토너먼트',
      'knockout-only': '토너먼트',
      'group-only': '조별 리그',
    }
    return labels[type] || type
  }

  const getCompetitionTypeLabel = (type: string) => {
    return type === 'team' ? '팀전' : '개인전'
  }

  const getMatchProgress = (project: typeof projects[0]) => {
    const total = project.matches.length
    const completed = project.matches.filter((m) => m.status === 'completed').length
    return { total, completed }
  }

  return (
    <div className={styles.container}>
      <Header
        title="대회 목록"
        subtitle={`총 ${projects.length}개의 프로젝트`}
        gradient="linear-gradient(135deg, #fbbc04 0%, #ea4335 100%)"
        showBack
        onBack={() => navigate('/admin')}
      />

      <main>
        <Card>
          <Input
            placeholder="프로젝트명, 날짜, 장소로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button variant="primary" onClick={() => navigate('/admin/create-project')}>
            + 새 프로젝트 만들기
          </Button>
        </Card>

        {sortedProjects.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>📋</p>
              <p>등록된 프로젝트가 없습니다</p>
              <Button variant="primary" onClick={() => navigate('/admin/create-project')}>
                첫 프로젝트 만들기
              </Button>
            </div>
          </Card>
        ) : (
          <div className={styles.projectList}>
            {sortedProjects.map((project) => {
              const progress = getMatchProgress(project)
              const progressPercent = progress.total > 0
                ? Math.round((progress.completed / progress.total) * 100)
                : 0

              return (
                <div
                  key={project.id}
                  className={styles.projectCard}
                  onClick={() => handleProjectClick(project.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleProjectClick(project.id)}
                >
                  <div className={styles.projectHeader}>
                    <h3 className={styles.projectName}>{project.name}</h3>
                    <span className={styles.badge}>
                      {getCompetitionTypeLabel(project.competitionType)}
                    </span>
                  </div>

                  <div className={styles.projectMeta}>
                    <span className={styles.tournamentType}>
                      {getTournamentTypeLabel(project.tournamentType)}
                    </span>
                    {project.date && (
                      <span className={styles.date}>📅 {project.date}</span>
                    )}
                    {project.location && (
                      <span className={styles.location}>📍 {project.location}</span>
                    )}
                  </div>

                  {progress.total > 0 && (
                    <div className={styles.progressSection}>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className={styles.progressText}>
                        {progress.completed}/{progress.total} 경기 완료 ({progressPercent}%)
                      </span>
                    </div>
                  )}

                  {progress.total === 0 && (
                    <div className={styles.noMatches}>
                      아직 등록된 경기가 없습니다
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
