import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { database, ref, onValue } from './firebase'
import type { Project, Match } from './types'
import './App.css'

// Home - Project List
function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const projectsRef = ref(database, 'projects')
    const unsubscribe = onValue(projectsRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        const projectList = Object.entries(data).map(([key, value]) => ({
          ...(value as Project),
          firebaseKey: key
        }))
        setProjects(projectList)
      } else {
        setProjects([])
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const getStats = (project: Project) => {
    const matches = project.matches || []
    return {
      total: matches.length,
      active: matches.filter(m => m.status === 'active').length,
      completed: matches.filter(m => m.status === 'completed').length,
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="loading">데이터 불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="container">
      <header className="header">
        <h1>쇼다운 실시간</h1>
        <p>대회 현황을 실시간으로 확인하세요</p>
      </header>

      <main>
        {projects.length === 0 ? (
          <div className="empty">등록된 대회가 없습니다.</div>
        ) : (
          projects.map((project) => {
            const stats = getStats(project)
            return (
              <div
                key={project.firebaseKey}
                className="card project-card"
                onClick={() => navigate(`/project/${project.firebaseKey}`)}
              >
                <div className="project-header">
                  <h2>{project.name}</h2>
                  {stats.active > 0 && <span className="live-badge">LIVE</span>}
                </div>
                <div className="project-meta">
                  <span>{project.date}</span>
                  <span>{project.location || '장소 미정'}</span>
                </div>
                <div className="project-stats">
                  <div className="stat">
                    <span className="stat-value">{stats.completed}</span>
                    <span className="stat-label">완료</span>
                  </div>
                  <div className="stat">
                    <span className={`stat-value ${stats.active > 0 ? 'live' : ''}`}>{stats.active}</span>
                    <span className="stat-label">진행중</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{stats.total - stats.completed - stats.active}</span>
                    <span className="stat-label">대기</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}

// Project Detail
function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'live' | 'standings' | 'bracket'>('live')

  useEffect(() => {
    if (!id) return

    const projectRef = ref(database, `projects/${id}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setProject({ ...data, firebaseKey: id })
      } else {
        setProject(null)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [id])

  if (loading) {
    return (
      <div className="container">
        <div className="loading">데이터 불러오는 중...</div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="container">
        <div className="empty">대회를 찾을 수 없습니다.</div>
        <button className="btn" onClick={() => navigate('/')}>목록으로</button>
      </div>
    )
  }

  const liveMatches = (project.matches || []).filter(m => m.status === 'active')
  const recentMatches = (project.matches || [])
    .filter(m => m.status === 'completed')
    .slice(-5)
    .reverse()

  const bracketMatches = (project.matches || []).filter(m => m.bracketRound && m.bracketRound > 0)

  // Group standings calculation
  const groupStandings = (project.groups || []).map(group => {
    const members = group.members || group.players || []
    const standingsMap: Record<string, { wins: number; losses: number; setDiff: number }> = {}

    members.forEach(name => {
      standingsMap[name] = { wins: 0, losses: 0, setDiff: 0 }
    })

    const groupMatches = (project.matches || []).filter(
      m => m.groupName === group.name && m.status === 'completed'
    )

    groupMatches.forEach(match => {
      const p1 = standingsMap[match.player1Name]
      const p2 = standingsMap[match.player2Name]
      if (!p1 || !p2) return

      p1.setDiff += (match.player1Sets || 0) - (match.player2Sets || 0)
      p2.setDiff += (match.player2Sets || 0) - (match.player1Sets || 0)

      if (match.winner === 1) { p1.wins++; p2.losses++ }
      else if (match.winner === 2) { p2.wins++; p1.losses++ }
    })

    const sorted = Object.entries(standingsMap)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.wins - a.wins || b.setDiff - a.setDiff)

    return { name: group.name, standings: sorted }
  })

  const advanceCount = project.groupSettings?.advanceCount || 2

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate('/')}>← 목록</button>
        <h1>{project.name}</h1>
        <p>{project.date}</p>
      </header>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          실시간 {liveMatches.length > 0 && <span className="tab-badge">{liveMatches.length}</span>}
        </button>
        <button className={`tab ${tab === 'standings' ? 'active' : ''}`} onClick={() => setTab('standings')}>
          순위
        </button>
        <button className={`tab ${tab === 'bracket' ? 'active' : ''}`} onClick={() => setTab('bracket')}>
          대진표
        </button>
      </div>

      <main>
        {/* Live Tab */}
        {tab === 'live' && (
          <>
            {liveMatches.length > 0 ? (
              <>
                <h3 className="section-title">진행 중</h3>
                {liveMatches.map(match => (
                  <LiveMatchCard key={match.id} match={match} />
                ))}
              </>
            ) : (
              <div className="empty">현재 진행 중인 경기가 없습니다.</div>
            )}

            {recentMatches.length > 0 && (
              <>
                <h3 className="section-title">최근 완료</h3>
                {recentMatches.map(match => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </>
            )}
          </>
        )}

        {/* Standings Tab */}
        {tab === 'standings' && (
          <>
            {groupStandings.length === 0 ? (
              <div className="empty">조별 리그 정보가 없습니다.</div>
            ) : (
              groupStandings.map(group => (
                <div key={group.name} className="card group-card">
                  <h3 className="group-name">{group.name}조</h3>
                  <div className="standings-table">
                    <div className="standings-header">
                      <span className="col-rank">#</span>
                      <span className="col-name">이름</span>
                      <span className="col-stat">승</span>
                      <span className="col-stat">패</span>
                      <span className="col-stat">득실</span>
                    </div>
                    {group.standings.map((player, idx) => (
                      <div key={player.name} className={`standings-row ${idx < advanceCount ? 'advance' : ''}`}>
                        <span className="col-rank">
                          <span className={`rank ${idx < advanceCount ? 'top' : ''}`}>{idx + 1}</span>
                        </span>
                        <span className="col-name">{player.name}</span>
                        <span className="col-stat wins">{player.wins}</span>
                        <span className="col-stat losses">{player.losses}</span>
                        <span className={`col-stat ${player.setDiff > 0 ? 'positive' : player.setDiff < 0 ? 'negative' : ''}`}>
                          {player.setDiff > 0 ? '+' : ''}{player.setDiff}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* Bracket Tab */}
        {tab === 'bracket' && (
          <>
            {bracketMatches.length === 0 ? (
              <div className="empty">본선 대진표가 없습니다.</div>
            ) : (
              <div className="bracket-wrapper">
                <div className="bracket">
                  {Object.entries(
                    bracketMatches.reduce((acc, m) => {
                      const round = m.bracketRound || 1
                      if (!acc[round]) acc[round] = []
                      acc[round].push(m)
                      return acc
                    }, {} as Record<number, Match[]>)
                  )
                    .sort(([a], [b]) => parseInt(a) - parseInt(b))
                    .map(([round, matches]) => (
                      <div key={round} className="bracket-round">
                        <div className="round-header">{matches[0]?.roundName || `${round}R`}</div>
                        <div className="round-matches">
                          {matches
                            .filter(m => !m.isThirdPlace)
                            .sort((a, b) => (a.bracketMatchNum || 0) - (b.bracketMatchNum || 0))
                            .map(match => (
                              <div key={match.id} className={`bracket-match ${match.status}`}>
                                <div className={`bracket-player ${match.winner === 1 ? 'winner' : ''}`}>
                                  <span>{match.player1Name || 'TBD'}</span>
                                  {match.status === 'completed' && <span>{match.player1Sets}</span>}
                                </div>
                                <div className={`bracket-player ${match.winner === 2 ? 'winner' : ''}`}>
                                  <span>{match.player2Name || 'TBD'}</span>
                                  {match.status === 'completed' && <span>{match.player2Sets}</span>}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// Live Match Card Component
function LiveMatchCard({ match }: { match: Match }) {
  const currentSetScore = match.sets?.[match.currentSet - 1]

  return (
    <div className="card live-card">
      <div className="live-header">
        <span className="live-badge">LIVE</span>
        <span className="match-stage">
          {match.groupName ? `${match.groupName}조` : match.roundName || '본선'}
        </span>
      </div>
      <div className="live-score">
        <div className="live-player">
          <span className="player-name">{match.player1Name}</span>
          <span className="set-score">{match.player1Sets || 0}</span>
        </div>
        <div className="current-score">
          <span>{currentSetScore?.player1Score ?? match.player1Score ?? 0}</span>
          <span className="separator">:</span>
          <span>{currentSetScore?.player2Score ?? match.player2Score ?? 0}</span>
        </div>
        <div className="live-player right">
          <span className="set-score">{match.player2Sets || 0}</span>
          <span className="player-name">{match.player2Name}</span>
        </div>
      </div>
      <div className="set-info">세트 {match.currentSet}</div>
    </div>
  )
}

// Match Card Component
function MatchCard({ match }: { match: Match }) {
  return (
    <div className="card match-card">
      <div className="match-stage">
        {match.groupName ? `${match.groupName}조` : match.roundName || '본선'}
      </div>
      <div className="match-result">
        <span className={`match-player ${match.winner === 1 ? 'winner' : ''}`}>
          {match.player1Name}
        </span>
        <span className="match-score">{match.player1Sets} - {match.player2Sets}</span>
        <span className={`match-player ${match.winner === 2 ? 'winner' : ''}`}>
          {match.player2Name}
        </span>
      </div>
    </div>
  )
}

// App Router
function App() {
  return (
    <BrowserRouter basename="/viewer-app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
