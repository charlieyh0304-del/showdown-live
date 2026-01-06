import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { database, ref, onValue } from './firebase'
import type { Project, Match } from './types'
import './App.css'

function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const projectsRef = ref(database, 'projects')
    return onValue(projectsRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setProjects(Object.entries(data).map(([key, value]) => ({
          ...(value as Project),
          firebaseKey: key
        })))
      }
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="container"><div className="loading">로딩 중...</div></div>

  return (
    <div className="container">
      <header className="header">
        <h1>관람 모드</h1>
        <p>실시간 경기 현황을 확인하세요</p>
      </header>
      <main>
        {projects.length === 0 ? (
          <div className="empty">등록된 대회가 없습니다</div>
        ) : (
          projects.map(project => {
            const active = (project.matches || []).filter(m => m.status === 'active').length
            const completed = (project.matches || []).filter(m => m.status === 'completed').length
            return (
              <div key={project.firebaseKey} className="card" onClick={() => navigate(`/project/${project.firebaseKey}`)}>
                <div className="card-header">
                  <h2>{project.name}</h2>
                  {active > 0 && <span className="badge live">LIVE {active}</span>}
                </div>
                <p className="meta">{project.date} • {project.location || '장소 미정'}</p>
                <p className="stats">완료 {completed} / 전체 {project.matches?.length || 0}</p>
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}

function ProjectView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [tab, setTab] = useState<'live' | 'standings' | 'bracket'>('live')

  useEffect(() => {
    if (!id) return
    return onValue(ref(database, `projects/${id}`), (snapshot) => {
      const data = snapshot.val()
      if (data) setProject({ ...data, firebaseKey: id })
    })
  }, [id])

  if (!project) return <div className="container"><div className="loading">로딩 중...</div></div>

  const liveMatches = (project.matches || []).filter(m => m.status === 'active')
  const completedMatches = (project.matches || []).filter(m => m.status === 'completed').slice(-5).reverse()
  const bracketMatches = (project.matches || []).filter(m => m.bracketRound)

  const getStandings = () => {
    return (project.groups || []).map(group => {
      const stats: Record<string, { wins: number; losses: number; diff: number }> = {}
      group.members.forEach(name => { stats[name] = { wins: 0, losses: 0, diff: 0 } })

      const groupMatches = (project.matches || [])
        .filter((m: Match) => m.groupName === group.name && m.status === 'completed')
      groupMatches.forEach((m: Match) => {
        if (stats[m.player1Name]) {
          stats[m.player1Name].diff += (m.player1Sets || 0) - (m.player2Sets || 0)
          if (m.winner === 1) stats[m.player1Name].wins++
          else stats[m.player1Name].losses++
        }
        if (stats[m.player2Name]) {
          stats[m.player2Name].diff += (m.player2Sets || 0) - (m.player1Sets || 0)
          if (m.winner === 2) stats[m.player2Name].wins++
          else stats[m.player2Name].losses++
        }
      })

      return {
        name: group.name,
        players: Object.entries(stats)
          .map(([name, s]) => ({ name, ...s }))
          .sort((a, b) => b.wins - a.wins || b.diff - a.diff)
      }
    })
  }

  return (
    <div className="container">
      <header className="header small">
        <button className="back" onClick={() => navigate('/')}>←</button>
        <div>
          <h1>{project.name}</h1>
          <p>{project.date}</p>
        </div>
      </header>

      <div className="tabs">
        <button className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>
          실시간 {liveMatches.length > 0 && <span className="badge">{liveMatches.length}</span>}
        </button>
        <button className={tab === 'standings' ? 'active' : ''} onClick={() => setTab('standings')}>순위</button>
        <button className={tab === 'bracket' ? 'active' : ''} onClick={() => setTab('bracket')}>대진표</button>
      </div>

      <main>
        {tab === 'live' && (
          <>
            {liveMatches.length > 0 ? (
              liveMatches.map(m => <LiveMatch key={m.id} match={m} />)
            ) : (
              <div className="empty">진행 중인 경기가 없습니다</div>
            )}
            {completedMatches.length > 0 && (
              <>
                <h3 className="section-title">최근 완료</h3>
                {completedMatches.map(m => (
                  <div key={m.id} className="card small">
                    <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                    <div className="result">
                      <span className={m.winner === 1 ? 'winner' : ''}>{m.player1Name}</span>
                      <span className="score">{m.player1Sets} - {m.player2Sets}</span>
                      <span className={m.winner === 2 ? 'winner' : ''}>{m.player2Name}</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {tab === 'standings' && (
          getStandings().length > 0 ? (
            getStandings().map(group => (
              <div key={group.name} className="card">
                <h3>{group.name}조</h3>
                <table className="standings">
                  <thead><tr><th>#</th><th>이름</th><th>승</th><th>패</th><th>득실</th></tr></thead>
                  <tbody>
                    {group.players.map((p, i) => (
                      <tr key={p.name} className={i < (project.groupSettings?.advanceCount || 2) ? 'advance' : ''}>
                        <td>{i + 1}</td>
                        <td>{p.name}</td>
                        <td className="wins">{p.wins}</td>
                        <td>{p.losses}</td>
                        <td className={p.diff > 0 ? 'positive' : p.diff < 0 ? 'negative' : ''}>
                          {p.diff > 0 ? '+' : ''}{p.diff}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          ) : (
            <div className="empty">조별 순위가 없습니다</div>
          )
        )}

        {tab === 'bracket' && (
          bracketMatches.length > 0 ? (
            <div className="bracket">
              {Object.entries(
                bracketMatches.reduce((acc, m) => {
                  const r = m.bracketRound || 1
                  if (!acc[r]) acc[r] = []
                  acc[r].push(m)
                  return acc
                }, {} as Record<number, Match[]>)
              ).sort(([a], [b]) => +a - +b).map(([round, matches]) => (
                <div key={round} className="round">
                  <div className="round-title">{matches[0]?.roundName || `${round}R`}</div>
                  {matches.map(m => (
                    <div key={m.id} className={`match ${m.status}`}>
                      <div className={m.winner === 1 ? 'winner' : ''}>{m.player1Name} {m.status === 'completed' && m.player1Sets}</div>
                      <div className={m.winner === 2 ? 'winner' : ''}>{m.player2Name} {m.status === 'completed' && m.player2Sets}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">대진표가 없습니다</div>
          )
        )}
      </main>
    </div>
  )
}

function LiveMatch({ match }: { match: Match }) {
  const set = match.sets?.[(match.currentSet - 1)]
  return (
    <div className="card live">
      <div className="live-header">
        <span className="badge live">LIVE</span>
        <span>{match.groupName ? `${match.groupName}조` : match.roundName}</span>
      </div>
      <div className="live-score">
        <div className="player">
          <span className="name">{match.player1Name}</span>
          <span className="sets">{match.player1Sets || 0}</span>
        </div>
        <div className="current">
          <span>{set?.player1Score || 0}</span>
          <span>:</span>
          <span>{set?.player2Score || 0}</span>
        </div>
        <div className="player right">
          <span className="sets">{match.player2Sets || 0}</span>
          <span className="name">{match.player2Name}</span>
        </div>
      </div>
      <div className="set-info">세트 {match.currentSet}</div>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/project/:id" element={<ProjectView />} />
      </Routes>
    </HashRouter>
  )
}
