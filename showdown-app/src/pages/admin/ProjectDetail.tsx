import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import { useProjectStore } from '@/stores'
import styles from './ProjectDetail.module.css'

export function ProjectDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)
  const currentProject = useProjectStore((state) => state.currentProject)
  const setCurrentProject = useProjectStore((state) => state.setCurrentProject)

  // Load project from URL param
  useEffect(() => {
    if (id) {
      const project = projects.find((p) => p.id === parseInt(id))
      if (project) {
        setCurrentProject(project)
      } else {
        navigate('/admin/projects')
      }
    }
  }, [id, projects, setCurrentProject, navigate])

  const project = currentProject

  // Calculate progress statistics
  const stats = useMemo(() => {
    if (!project) return null

    const isTeam = project.competitionType === 'team'
    const total = project.matches?.length || 0
    const completed = project.matches?.filter((m) => m.status === 'completed').length || 0
    const inProgress = project.matches?.filter((m) => m.status === 'active').length || 0
    const pending = total - completed - inProgress
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0

    const hasParticipants = isTeam ? (project.teams?.length > 0) : (project.players?.length > 0)
    const hasGroups = project.groups?.length > 0
    const hasMatches = total > 0
    const hasReferees = (project.referees?.length ?? 0) > 0
    const hasCourts = (project.courts?.length ?? 0) > 0
    const hasSchedule = project.matches?.some((m) => m.scheduledDate && m.scheduledTime) || false

    const groupMatches = project.matches?.filter((m) => !m.bracketRound && !m.isLoserBracket) || []
    const groupCompleted = groupMatches.filter((m) => m.status === 'completed').length
    const groupTotal = groupMatches.length
    const isGroupDone = groupTotal > 0 && groupCompleted === groupTotal

    const knockoutMatches = project.matches?.filter((m) => m.bracketRound) || []
    const hasKnockout = knockoutMatches.length > 0
    const knockoutCompleted = knockoutMatches.filter((m) => m.status === 'completed').length
    const isKnockoutDone = hasKnockout && knockoutCompleted === knockoutMatches.length

    const isTournamentComplete =
      (project.tournamentType === 'group-only' && isGroupDone) ||
      (project.tournamentType === 'knockout-only' && isKnockoutDone) ||
      (project.tournamentType === 'group-tournament' && isKnockoutDone) ||
      (project.tournamentType === 'tournament' && isKnockoutDone)

    return {
      isTeam,
      total,
      completed,
      inProgress,
      pending,
      progress,
      hasParticipants,
      hasGroups,
      hasMatches,
      hasReferees,
      hasCourts,
      hasSchedule,
      groupMatches,
      groupCompleted,
      groupTotal,
      isGroupDone,
      knockoutMatches,
      hasKnockout,
      knockoutCompleted,
      isKnockoutDone,
      isTournamentComplete,
    }
  }, [project])

  // Calculate current step and next action
  const guidance = useMemo(() => {
    if (!project || !stats) return null

    let currentStep = 1
    let nextAction = { text: '', route: '', style: '' }

    if (!stats.hasParticipants || !stats.hasMatches) {
      currentStep = 1
      nextAction = {
        text: '⚠️ 대진표가 생성되지 않았습니다',
        route: '',
        style: 'warning'
      }
    } else if (!stats.hasReferees || !stats.hasCourts) {
      currentStep = 2
      nextAction = {
        text: !stats.hasReferees ? '👨‍⚖️ 심판을 등록하세요' : '🏟️ 경기장을 등록하세요',
        route: !stats.hasReferees ? '/admin/referees' : '/admin/courts',
        style: 'info',
      }
    } else if (!stats.hasSchedule) {
      currentStep = 3
      nextAction = {
        text: '📅 경기 스케줄을 배정하세요',
        route: `/tournament/schedule/${project.id}`,
        style: 'primary',
      }
    } else if (project.tournamentType === 'group-tournament' && !stats.isGroupDone) {
      currentStep = 4
      nextAction = {
        text: `⚔️ 조별 예선 진행 중 (${stats.groupCompleted}/${stats.groupTotal})`,
        route: `/tournament/bracket/${project.id}`,
        style: 'success',
      }
    } else if (project.tournamentType === 'group-tournament' && stats.isGroupDone && !stats.hasKnockout) {
      currentStep = 5
      nextAction = {
        text: '🏆 본선 대진표를 생성하세요!',
        route: `/tournament/bracket/${project.id}`,
        style: 'info',
      }
    } else if (stats.hasKnockout && !stats.isKnockoutDone) {
      currentStep = 6
      nextAction = {
        text: `🏆 본선 진행 중 (${stats.knockoutCompleted}/${stats.knockoutMatches.length})`,
        route: `/tournament/bracket/${project.id}`,
        style: 'success',
      }
    } else if (stats.isTournamentComplete) {
      currentStep = 7
      nextAction = {
        text: '🎉 대회 완료! 결과를 확인하세요',
        route: `/tournament/standings/${project.id}`,
        style: 'complete',
      }
    } else {
      currentStep = 4
      nextAction = {
        text: `⚔️ 경기 진행 중 (${stats.completed}/${stats.total})`,
        route: `/tournament/bracket/${project.id}`,
        style: 'success',
      }
    }

    // Build steps
    const steps = [
      { num: 1, label: '대회생성', done: stats.hasMatches },
      { num: 2, label: '심판/경기장', done: stats.hasReferees && stats.hasCourts },
      { num: 3, label: '스케줄', done: stats.hasSchedule },
      { num: 4, label: project.tournamentType === 'knockout-only' || project.tournamentType === 'tournament' ? '본선' : '예선', done: project.tournamentType === 'knockout-only' || project.tournamentType === 'tournament' ? stats.isKnockoutDone : stats.isGroupDone },
    ]

    if (project.tournamentType === 'group-tournament') {
      steps.push({ num: 5, label: '본선생성', done: stats.hasKnockout })
      steps.push({ num: 6, label: '본선진행', done: stats.isKnockoutDone })
    }
    steps.push({ num: steps.length + 1, label: '완료', done: stats.isTournamentComplete })

    return { currentStep, nextAction, steps }
  }, [project, stats])

  // Recent matches (pending/active)
  const recentMatches = useMemo(() => {
    if (!project?.matches) return []
    return project.matches
      .filter((m) => m.status !== 'completed')
      .slice(0, 5)
  }, [project])

  if (!project || !stats || !guidance) {
    return (
      <div className={styles.container}>
        <Card>
          <p>프로젝트를 불러오는 중...</p>
        </Card>
      </div>
    )
  }

  const getTournamentTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'group': '조별 리그',
      'tournament': '토너먼트',
      'group-tournament': '조별 리그 + 토너먼트',
      'knockout-only': '토너먼트',
      'group-only': '조별 리그',
    }
    return labels[type] || '리그전'
  }

  return (
    <div className={styles.container}>
      <Header
        title={project.name}
        subtitle={`${project.date || ''} ${project.location ? '· ' + project.location : ''}`}
        gradient="linear-gradient(135deg, #ff9800 0%, #f57c00 100%)"
        showBack
        onBack={() => navigate('/admin/projects')}
      />

      <main>
        {/* Back button */}
        <Card>
          <Button onClick={() => navigate('/admin/projects')}>
            ← 대회 목록
          </Button>
        </Card>

        {/* Progress Guide */}
        <Card>
          <h3 className={styles.sectionTitle}>📋 진행 가이드</h3>

          {/* Steps indicator */}
          <div className={styles.stepsContainer}>
            {guidance.steps.map((step, index) => (
              <div key={step.num} className={styles.stepItem}>
                <div
                  className={`${styles.stepCircle} ${
                    step.done ? styles.done : step.num === guidance.currentStep ? styles.current : ''
                  }`}
                >
                  {step.done ? '✓' : step.num}
                </div>
                <div
                  className={`${styles.stepLabel} ${
                    step.done ? styles.done : step.num === guidance.currentStep ? styles.current : ''
                  }`}
                >
                  {step.label}
                </div>
                {index < guidance.steps.length - 1 && (
                  <div className={`${styles.stepLine} ${step.done ? styles.done : ''}`} />
                )}
              </div>
            ))}
          </div>

          {/* Next action */}
          {guidance.nextAction.text && (
            <div className={`${styles.nextAction} ${styles[guidance.nextAction.style]}`}>
              <div className={styles.nextActionText}>{guidance.nextAction.text}</div>
              {guidance.nextAction.route && (
                <Button
                  variant="primary"
                  onClick={() => navigate(guidance.nextAction.route)}
                >
                  지금 하러 가기 →
                </Button>
              )}
            </div>
          )}
        </Card>

        {/* Group Stage Status */}
        {project.groups && project.groups.length > 0 && (
          <Card className={styles.groupStatusCard}>
            <h3>📊 조별 리그 진행</h3>
            <div className={styles.statusRow}>
              <span>예선 경기</span>
              <strong>{stats.groupCompleted}/{stats.groupTotal} 완료</strong>
            </div>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${stats.groupTotal > 0 ? (stats.groupCompleted / stats.groupTotal) * 100 : 0}%` }}
              />
            </div>
            {stats.groupCompleted === stats.groupTotal && !stats.hasKnockout && (
              <Button
                variant="primary"
                onClick={() => navigate(`/tournament/bracket/${project.id}`)}
              >
                🏆 본선 대진표 생성하기
              </Button>
            )}
            {stats.hasKnockout && (
              <div className={styles.knockoutInfo}>
                ✅ 본선 {stats.knockoutMatches.length}경기 생성됨
              </div>
            )}
          </Card>
        )}

        {/* Overall Progress */}
        <Card>
          <h3 className={styles.sectionTitle}>📈 전체 진행률</h3>
          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.total}</span>
              <span className={styles.statLabel}>전체 경기</span>
            </div>
            <div className={styles.statItem}>
              <span className={`${styles.statValue} ${styles.success}`}>{stats.completed}</span>
              <span className={styles.statLabel}>완료</span>
            </div>
            <div className={styles.statItem}>
              <span className={`${styles.statValue} ${styles.warning}`}>{stats.inProgress}</span>
              <span className={styles.statLabel}>진행 중</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{stats.pending}</span>
              <span className={styles.statLabel}>대기</span>
            </div>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${stats.progress}%` }}
            />
          </div>
          <div className={styles.progressText}>{stats.progress}% 완료</div>
        </Card>

        {/* Recent Matches */}
        <Card>
          <h3 className={styles.sectionTitle}>⚔️ 대기 중인 경기</h3>
          {recentMatches.length === 0 ? (
            <div className={styles.emptyMatches}>
              대기 중인 경기가 없습니다.
            </div>
          ) : (
            <div className={styles.matchList}>
              {recentMatches.map((match) => {
                const label = match.groupName
                  ? `[${match.groupName}]`
                  : match.roundName
                  ? `[${match.roundName}]`
                  : match.bracketRound
                  ? '[본선]'
                  : ''
                const statusIcon = match.status === 'active' ? '🔴' : '⏳'

                return (
                  <div key={match.id} className={styles.matchItem}>
                    <div className={styles.matchInfo}>
                      <span className={styles.matchLabel}>{label}</span>
                      <div className={styles.matchPlayers}>
                        {statusIcon} {match.player1Name} vs {match.player2Name}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      fullWidth={false}
                      onClick={() => navigate(`/referee/match/${match.id}?project=${project.id}`)}
                    >
                      {match.status === 'active' ? '이어하기' : '시작'}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Management Buttons */}
        <Card>
          <h3 className={styles.sectionTitle}>⚙️ 대회 관리</h3>
          <div className={styles.managementGrid}>
            <Button onClick={() => navigate(`/tournament/${stats.isTeam ? 'teams' : 'players'}/${project.id}`)}>
              {stats.isTeam ? '👥 팀 관리' : '👤 선수 관리'}
            </Button>
            <Button onClick={() => navigate(`/tournament/groups/${project.id}`)}>
              📊 조 관리
            </Button>
            <Button onClick={() => navigate(`/tournament/bracket/${project.id}`)}>
              🏆 대진표
            </Button>
            <Button onClick={() => navigate(`/tournament/schedule/${project.id}`)}>
              📅 스케줄
            </Button>
            <Button onClick={() => navigate(`/tournament/standings/${project.id}`)}>
              🥇 순위표
            </Button>
            <Button onClick={() => navigate(`/tournament/statistics/${project.id}`)}>
              📈 통계
            </Button>
          </div>
        </Card>

        {/* Project Info */}
        <Card>
          <h3 className={styles.sectionTitle}>ℹ️ 대회 정보</h3>
          <div className={styles.infoList}>
            <div className={styles.infoItem}>
              <span>유형</span>
              <span>{getTournamentTypeLabel(project.tournamentType)}</span>
            </div>
            <div className={styles.infoItem}>
              <span>종류</span>
              <span>{stats.isTeam ? '팀전' : '개인전'}</span>
            </div>
            {stats.isTeam ? (
              <div className={styles.infoItem}>
                <span>참가 팀</span>
                <span>{project.teams?.length || 0}팀</span>
              </div>
            ) : (
              <div className={styles.infoItem}>
                <span>참가 선수</span>
                <span>{project.players?.length || 0}명</span>
              </div>
            )}
            <div className={styles.infoItem}>
              <span>조</span>
              <span>{project.groups?.length || 0}개</span>
            </div>
          </div>
        </Card>
      </main>
    </div>
  )
}
