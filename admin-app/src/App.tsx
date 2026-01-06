import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { database, ref, onValue, update, push, remove } from './firebase'
import type { Project, Match, Group } from './types'
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
      } else {
        setProjects([])
      }
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="container"><div className="loading">로딩 중...</div></div>

  return (
    <div className="container">
      <header className="header">
        <h1>관리자 모드</h1>
        <p>대회를 생성하고 관리하세요</p>
      </header>
      <main>
        <button className="btn primary full" onClick={() => navigate('/create')}>
          + 새 대회 만들기
        </button>
        {projects.length === 0 ? (
          <div className="empty">등록된 대회가 없습니다</div>
        ) : (
          projects.map(project => (
            <div key={project.firebaseKey} className="card" onClick={() => navigate(`/project/${project.firebaseKey}`)}>
              <div className="card-header">
                <h2>{project.name}</h2>
                <span className="badge">{project.matches?.length || 0} 경기</span>
              </div>
              <p className="meta">{project.date} • {project.location || '장소 미정'}</p>
            </div>
          ))
        )}
      </main>
    </div>
  )
}

function CreateProject() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [location, setLocation] = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) return alert('대회 이름을 입력하세요')

    const newProject: Omit<Project, 'firebaseKey'> = {
      id: Date.now(),
      name: name.trim(),
      date,
      location: location.trim(),
      players: [],
      matches: [],
      groups: [],
      groupSettings: { advanceCount: 2 }
    }

    const projectsRef = ref(database, 'projects')
    await push(projectsRef, newProject)
    navigate('/')
  }

  return (
    <div className="container">
      <header className="header small">
        <button className="back" onClick={() => navigate('/')}>←</button>
        <div><h1>새 대회 만들기</h1></div>
      </header>
      <main>
        <div className="form-group">
          <label>대회 이름</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="예: 2024 전국 쇼다운 대회" />
        </div>
        <div className="form-group">
          <label>날짜</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>장소</label>
          <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="예: 서울 체육관" />
        </div>
        <button className="btn primary full" onClick={handleSubmit}>대회 생성</button>
      </main>
    </div>
  )
}

function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [tab, setTab] = useState<'players' | 'groups' | 'matches'>('players')

  useEffect(() => {
    if (!id) return
    return onValue(ref(database, `projects/${id}`), (snapshot) => {
      const data = snapshot.val()
      if (data) setProject({ ...data, firebaseKey: id })
    })
  }, [id])

  if (!project) return <div className="container"><div className="loading">로딩 중...</div></div>

  const deleteProject = async () => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    await remove(ref(database, `projects/${id}`))
    navigate('/')
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
        <button className={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>선수</button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>조편성</button>
        <button className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>경기</button>
      </div>

      <main>
        {tab === 'players' && <PlayersTab projectId={id!} project={project} />}
        {tab === 'groups' && <GroupsTab projectId={id!} project={project} />}
        {tab === 'matches' && <MatchesTab projectId={id!} project={project} />}
      </main>

      <div className="danger-zone">
        <button className="btn danger" onClick={deleteProject}>대회 삭제</button>
      </div>
    </div>
  )
}

function PlayersTab({ projectId, project }: { projectId: string; project: Project }) {
  const [newPlayer, setNewPlayer] = useState('')
  const players = project.players || []

  const addPlayer = async () => {
    if (!newPlayer.trim()) return
    if (players.includes(newPlayer.trim())) return alert('이미 등록된 선수입니다')
    const updated = [...players, newPlayer.trim()]
    await update(ref(database, `projects/${projectId}`), { players: updated })
    setNewPlayer('')
  }

  const removePlayer = async (name: string) => {
    const updated = players.filter(p => p !== name)
    await update(ref(database, `projects/${projectId}`), { players: updated })
  }

  return (
    <>
      <div className="input-row">
        <input type="text" value={newPlayer} onChange={e => setNewPlayer(e.target.value)} placeholder="선수 이름" onKeyPress={e => e.key === 'Enter' && addPlayer()} />
        <button className="btn primary" onClick={addPlayer}>추가</button>
      </div>
      <div className="list">
        {players.length === 0 ? (
          <div className="empty">등록된 선수가 없습니다</div>
        ) : (
          players.map(p => (
            <div key={p} className="list-item">
              <span>{p}</span>
              <button className="btn-icon" onClick={() => removePlayer(p)}>×</button>
            </div>
          ))
        )}
      </div>
      <div className="stats-bar">{players.length}명 등록됨</div>
    </>
  )
}

function GroupsTab({ projectId, project }: { projectId: string; project: Project }) {
  const players = project.players || []
  const groups = project.groups || []

  const autoCreateGroups = async () => {
    if (players.length < 2) return alert('최소 2명의 선수가 필요합니다')
    const groupCount = Math.max(1, Math.ceil(players.length / 4))
    const shuffled = [...players].sort(() => Math.random() - 0.5)
    const newGroups: Group[] = []
    const groupNames = 'ABCDEFGHIJKLMNOP'.split('')
    for (let i = 0; i < groupCount; i++) newGroups.push({ name: groupNames[i], members: [] })
    shuffled.forEach((player, i) => newGroups[i % groupCount].members.push(player))
    await update(ref(database, `projects/${projectId}`), { groups: newGroups })
  }

  const clearGroups = async () => {
    await update(ref(database, `projects/${projectId}`), { groups: [] })
  }

  const generateMatches = async () => {
    if (groups.length === 0) return alert('조편성을 먼저 해주세요')
    const matches: Match[] = []
    let matchId = 1
    groups.forEach(group => {
      const members = group.members
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          matches.push({
            id: matchId++, player1Name: members[i], player2Name: members[j],
            sets: [], setsToWin: 3, currentSet: 1, currentServer: 1,
            status: 'pending', groupName: group.name
          })
        }
      }
    })
    await update(ref(database, `projects/${projectId}`), { matches })
    alert(`${matches.length}개 경기가 생성되었습니다`)
  }

  return (
    <>
      <div className="btn-row">
        <button className="btn primary" onClick={autoCreateGroups}>자동 조편성</button>
        <button className="btn" onClick={clearGroups}>초기화</button>
      </div>
      {groups.length === 0 ? (
        <div className="empty">조편성이 없습니다</div>
      ) : (
        <>
          {groups.map(g => (
            <div key={g.name} className="card">
              <h3>{g.name}조</h3>
              <div className="group-members">
                {g.members.map(m => <span key={m} className="member-chip">{m}</span>)}
              </div>
            </div>
          ))}
          <button className="btn primary full" onClick={generateMatches}>조별 경기 생성</button>
        </>
      )}
    </>
  )
}

function MatchesTab({ projectId, project }: { projectId: string; project: Project }) {
  const matches = project.matches || []

  const updateMatchStatus = async (matchIndex: number, status: Match['status']) => {
    const updated = [...matches]
    updated[matchIndex] = { ...updated[matchIndex], status }
    await update(ref(database, `projects/${projectId}`), { matches: updated })
  }

  const resetMatch = async (matchIndex: number) => {
    const updated = [...matches]
    updated[matchIndex] = { ...updated[matchIndex], status: 'pending', sets: [], player1Sets: 0, player2Sets: 0, currentSet: 1, winner: undefined }
    await update(ref(database, `projects/${projectId}`), { matches: updated })
  }

  const deleteAllMatches = async () => {
    if (!confirm('모든 경기를 삭제하시겠습니까?')) return
    await update(ref(database, `projects/${projectId}`), { matches: [] })
  }

  const pendingMatches = matches.filter(m => m.status === 'pending')
  const readyMatches = matches.filter(m => m.status === 'ready')
  const activeMatches = matches.filter(m => m.status === 'active')
  const completedMatches = matches.filter(m => m.status === 'completed')

  return (
    <>
      {matches.length === 0 ? (
        <div className="empty">경기가 없습니다</div>
      ) : (
        <>
          {activeMatches.length > 0 && (
            <section>
              <h3 className="section-title">진행 중 ({activeMatches.length})</h3>
              {activeMatches.map((m) => (
                <div key={m.id} className="match-card active">
                  <div className="match-header">
                    <span className="badge live">LIVE</span>
                    <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                  </div>
                  <div className="match-score">
                    <span>{m.player1Name}</span>
                    <span className="score">{m.player1Sets || 0} - {m.player2Sets || 0}</span>
                    <span>{m.player2Name}</span>
                  </div>
                </div>
              ))}
            </section>
          )}
          {readyMatches.length > 0 && (
            <section>
              <h3 className="section-title">대기 중 ({readyMatches.length})</h3>
              {readyMatches.map(m => {
                const idx = matches.indexOf(m)
                return (
                  <div key={m.id} className="match-card">
                    <div className="match-header">
                      <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                      <button className="btn-small" onClick={() => updateMatchStatus(idx, 'pending')}>취소</button>
                    </div>
                    <div className="match-players">
                      <span>{m.player1Name}</span>
                      <span className="vs">VS</span>
                      <span>{m.player2Name}</span>
                    </div>
                  </div>
                )
              })}
            </section>
          )}
          {pendingMatches.length > 0 && (
            <section>
              <h3 className="section-title">예정 ({pendingMatches.length})</h3>
              {pendingMatches.map(m => {
                const idx = matches.indexOf(m)
                return (
                  <div key={m.id} className="match-card">
                    <div className="match-header">
                      <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                      <button className="btn-small primary" onClick={() => updateMatchStatus(idx, 'ready')}>준비</button>
                    </div>
                    <div className="match-players">
                      <span>{m.player1Name}</span>
                      <span className="vs">VS</span>
                      <span>{m.player2Name}</span>
                    </div>
                  </div>
                )
              })}
            </section>
          )}
          {completedMatches.length > 0 && (
            <section>
              <h3 className="section-title">완료 ({completedMatches.length})</h3>
              {completedMatches.map(m => {
                const idx = matches.indexOf(m)
                return (
                  <div key={m.id} className="match-card completed">
                    <div className="match-header">
                      <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                      <button className="btn-small" onClick={() => resetMatch(idx)}>초기화</button>
                    </div>
                    <div className="match-score">
                      <span className={m.winner === 1 ? 'winner' : ''}>{m.player1Name}</span>
                      <span className="score">{m.player1Sets} - {m.player2Sets}</span>
                      <span className={m.winner === 2 ? 'winner' : ''}>{m.player2Name}</span>
                    </div>
                  </div>
                )
              })}
            </section>
          )}
          <button className="btn danger full" onClick={deleteAllMatches}>모든 경기 삭제</button>
        </>
      )}
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateProject />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
      </Routes>
    </HashRouter>
  )
}
