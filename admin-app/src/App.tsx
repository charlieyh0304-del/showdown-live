import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { database, ref, onValue, set, update, push, remove } from './firebase'
import type { Project, Match, Group } from './types'
import './App.css'

// 홈 - 대회 목록
function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const projectsRef = ref(database, 'projects')
    const unsubscribe = onValue(projectsRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        const list = Object.entries(data).map(([key, value]) => ({
          ...(value as Project),
          firebaseKey: key
        }))
        setProjects(list)
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
      completed: matches.filter(m => m.status === 'completed').length,
      players: project.players?.length || 0
    }
  }

  if (loading) {
    return <div className="container"><div className="loading">불러오는 중...</div></div>
  }

  return (
    <div className="container">
      <header className="header">
        <h1>🛠️ 관리자 모드</h1>
        <p>대회를 생성하고 관리하세요</p>
      </header>

      <main>
        <button className="create-btn" onClick={() => navigate('/create')}>
          + 새 대회 만들기
        </button>

        {projects.length === 0 ? (
          <div className="empty">등록된 대회가 없습니다.</div>
        ) : (
          projects.map(project => {
            const stats = getStats(project)
            return (
              <div
                key={project.firebaseKey}
                className="card project-card"
                onClick={() => navigate(`/project/${project.firebaseKey}`)}
              >
                <h2>{project.name}</h2>
                <p className="project-meta">{project.date} • {project.location || '장소 미정'}</p>
                <div className="project-stats">
                  <span>선수 {stats.players}명</span>
                  <span>경기 {stats.completed}/{stats.total}</span>
                </div>
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}

// 대회 생성
function CreateProject() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) {
      alert('대회 이름을 입력하세요')
      return
    }

    setSaving(true)
    const newProject: Omit<Project, 'firebaseKey'> = {
      id: Date.now(),
      name: name.trim(),
      date,
      location: location.trim(),
      desc: '',
      competitionType: 'individual',
      tournamentType: 'group-knockout',
      players: [],
      matches: [],
      groups: [],
      groupSettings: { groupCount: 4, advanceCount: 2, setsPerMatch: 3 }
    }

    try {
      const projectsRef = ref(database, 'projects')
      const newRef = push(projectsRef)
      await set(newRef, newProject)
      navigate(`/project/${newRef.key}`)
    } catch (error) {
      alert('저장 실패')
      setSaving(false)
    }
  }

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate('/')}>← 뒤로</button>
        <h1>새 대회 만들기</h1>
      </header>

      <main>
        <div className="form-group">
          <label>대회 이름 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 2024 전국 쇼다운 대회"
          />
        </div>

        <div className="form-group">
          <label>날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>장소</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="예: 서울 올림픽공원"
          />
        </div>

        <button className="primary-btn" onClick={handleCreate} disabled={saving}>
          {saving ? '저장 중...' : '대회 생성'}
        </button>
      </main>
    </div>
  )
}

// 대회 상세
function ProjectDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const projectRef = ref(database, `projects/${id}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setProject({ ...data, firebaseKey: id })
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [id])

  const handleDelete = async () => {
    if (!id || !confirm('정말 삭제하시겠습니까?')) return
    await remove(ref(database, `projects/${id}`))
    navigate('/')
  }

  if (loading) return <div className="container"><div className="loading">불러오는 중...</div></div>
  if (!project) return <div className="container"><div className="empty">대회를 찾을 수 없습니다.</div></div>

  const stats = {
    players: project.players?.length || 0,
    groups: project.groups?.length || 0,
    matches: project.matches?.length || 0,
    completed: (project.matches || []).filter(m => m.status === 'completed').length
  }

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate('/')}>← 목록</button>
        <h1>{project.name}</h1>
        <p>{project.date}</p>
      </header>

      <main>
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-value">{stats.players}</span>
            <span className="stat-label">선수</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.groups}</span>
            <span className="stat-label">조</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{stats.completed}/{stats.matches}</span>
            <span className="stat-label">경기</span>
          </div>
        </div>

        <div className="menu-list">
          <button className="menu-item" onClick={() => navigate(`/project/${id}/players`)}>
            <span>👤 선수 관리</span>
            <span className="arrow">→</span>
          </button>
          <button className="menu-item" onClick={() => navigate(`/project/${id}/groups`)}>
            <span>📋 조 편성</span>
            <span className="arrow">→</span>
          </button>
          <button className="menu-item" onClick={() => navigate(`/project/${id}/matches`)}>
            <span>🏓 경기 관리</span>
            <span className="arrow">→</span>
          </button>
          <button className="menu-item" onClick={() => navigate(`/project/${id}/bracket`)}>
            <span>🏆 토너먼트 브라켓</span>
            <span className="arrow">→</span>
          </button>
        </div>

        <button className="danger-btn" onClick={handleDelete}>
          🗑️ 대회 삭제
        </button>
      </main>
    </div>
  )
}

// 선수 관리
function ManagePlayers() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [newPlayer, setNewPlayer] = useState('')

  useEffect(() => {
    if (!id) return
    const projectRef = ref(database, `projects/${id}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) setProject({ ...data, firebaseKey: id })
    })
    return () => unsubscribe()
  }, [id])

  const addPlayer = async () => {
    if (!newPlayer.trim() || !id) return
    const players = [...(project?.players || []), newPlayer.trim()]
    await update(ref(database, `projects/${id}`), { players })
    setNewPlayer('')
  }

  const removePlayer = async (index: number) => {
    if (!id) return
    const players = [...(project?.players || [])]
    players.splice(index, 1)
    await update(ref(database, `projects/${id}`), { players })
  }

  if (!project) return <div className="container"><div className="loading">불러오는 중...</div></div>

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate(`/project/${id}`)}>← 뒤로</button>
        <h1>선수 관리</h1>
        <p>{project.players?.length || 0}명</p>
      </header>

      <main>
        <div className="input-group">
          <input
            type="text"
            value={newPlayer}
            onChange={(e) => setNewPlayer(e.target.value)}
            placeholder="선수 이름"
            onKeyPress={(e) => e.key === 'Enter' && addPlayer()}
          />
          <button className="add-btn" onClick={addPlayer}>추가</button>
        </div>

        <div className="player-list">
          {(project.players || []).map((player, idx) => (
            <div key={idx} className="player-item">
              <span>{idx + 1}. {player}</span>
              <button className="delete-btn" onClick={() => removePlayer(idx)}>✕</button>
            </div>
          ))}
        </div>

        {(project.players?.length || 0) === 0 && (
          <div className="empty">선수를 추가하세요</div>
        )}
      </main>
    </div>
  )
}

// 조 편성
function ManageGroups() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [groupCount, setGroupCount] = useState(4)

  useEffect(() => {
    if (!id) return
    const projectRef = ref(database, `projects/${id}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setProject({ ...data, firebaseKey: id })
        setGroupCount(data.groupSettings?.groupCount || 4)
      }
    })
    return () => unsubscribe()
  }, [id])

  const generateGroups = async () => {
    if (!id || !project) return
    const players = project.players || []
    if (players.length < groupCount) {
      alert(`최소 ${groupCount}명의 선수가 필요합니다`)
      return
    }

    const shuffled = [...players].sort(() => Math.random() - 0.5)
    const groups: Group[] = []
    const groupNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

    for (let i = 0; i < groupCount; i++) {
      groups.push({ name: groupNames[i], members: [] })
    }

    shuffled.forEach((player, idx) => {
      groups[idx % groupCount].members.push(player)
    })

    // Generate matches for each group
    const matches: Match[] = []
    let matchId = 1
    groups.forEach((group, groupIdx) => {
      for (let i = 0; i < group.members.length; i++) {
        for (let j = i + 1; j < group.members.length; j++) {
          matches.push({
            id: matchId++,
            player1Name: group.members[i],
            player2Name: group.members[j],
            status: 'pending',
            sets: [],
            setsToWin: project.groupSettings?.setsPerMatch || 2,
            currentSet: 1,
            currentServer: 1,
            groupName: group.name,
            groupIndex: groupIdx
          })
        }
      }
    })

    await update(ref(database, `projects/${id}`), {
      groups,
      matches,
      groupSettings: { ...project.groupSettings, groupCount }
    })
  }

  if (!project) return <div className="container"><div className="loading">불러오는 중...</div></div>

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate(`/project/${id}`)}>← 뒤로</button>
        <h1>조 편성</h1>
      </header>

      <main>
        <div className="form-group">
          <label>조 개수</label>
          <select value={groupCount} onChange={(e) => setGroupCount(parseInt(e.target.value))}>
            {[2, 3, 4, 5, 6, 7, 8].map(n => (
              <option key={n} value={n}>{n}개 조</option>
            ))}
          </select>
        </div>

        <button className="primary-btn" onClick={generateGroups}>
          🎲 자동 조 편성
        </button>

        {(project.groups || []).length > 0 && (
          <div className="groups-grid">
            {project.groups.map((group, idx) => (
              <div key={idx} className="group-card">
                <h3>{group.name}조</h3>
                <ul>
                  {group.members.map((member, mIdx) => (
                    <li key={mIdx}>{member}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// 경기 관리
function ManageMatches() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')

  useEffect(() => {
    if (!id) return
    const projectRef = ref(database, `projects/${id}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) setProject({ ...data, firebaseKey: id })
    })
    return () => unsubscribe()
  }, [id])

  const resetMatch = async (matchId: number) => {
    if (!id || !project || !confirm('경기를 초기화하시겠습니까?')) return
    const matches = project.matches.map(m =>
      m.id === matchId ? {
        ...m,
        status: 'pending' as const,
        sets: [],
        player1Sets: 0,
        player2Sets: 0,
        currentSet: 1,
        winner: undefined
      } : m
    )
    await update(ref(database, `projects/${id}`), { matches })
  }

  if (!project) return <div className="container"><div className="loading">불러오는 중...</div></div>

  const filteredMatches = (project.matches || []).filter(m => {
    if (filter === 'pending') return m.status !== 'completed'
    if (filter === 'completed') return m.status === 'completed'
    return true
  })

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate(`/project/${id}`)}>← 뒤로</button>
        <h1>경기 관리</h1>
        <p>{project.matches?.length || 0}경기</p>
      </header>

      <main>
        <div className="filter-tabs">
          {(['all', 'pending', 'completed'] as const).map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '전체' : f === 'pending' ? '대기' : '완료'}
            </button>
          ))}
        </div>

        <div className="match-list">
          {filteredMatches.map(match => (
            <div key={match.id} className={`match-item ${match.status}`}>
              <div className="match-content">
                <span className="match-group">{match.groupName ? `${match.groupName}조` : match.roundName || ''}</span>
                <span className="match-players">{match.player1Name} vs {match.player2Name}</span>
                {match.status === 'completed' && (
                  <span className="match-score">{match.player1Sets} - {match.player2Sets}</span>
                )}
              </div>
              <button className="reset-btn" onClick={() => resetMatch(match.id)}>↻</button>
            </div>
          ))}
        </div>

        {filteredMatches.length === 0 && (
          <div className="empty">경기가 없습니다</div>
        )}
      </main>
    </div>
  )
}

// 토너먼트 브라켓
function ManageBracket() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [bracketSize, setBracketSize] = useState(8)

  useEffect(() => {
    if (!id) return
    const projectRef = ref(database, `projects/${id}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setProject({ ...data, firebaseKey: id })
        setBracketSize(data.tournamentSettings?.size || 8)
      }
    })
    return () => unsubscribe()
  }, [id])

  const generateBracket = async () => {
    if (!id || !project) return

    const advanceCount = project.groupSettings?.advanceCount || 2
    const groups = project.groups || []

    // Get top players from each group
    const qualifiedPlayers: { name: string; group: string; rank: number }[] = []

    groups.forEach(group => {
      // Calculate standings (simplified)
      const standings = group.members.map(name => {
        const wins = (project.matches || []).filter(
          m => m.groupName === group.name && m.status === 'completed' &&
            ((m.player1Name === name && m.winner === 1) || (m.player2Name === name && m.winner === 2))
        ).length
        return { name, wins }
      }).sort((a, b) => b.wins - a.wins)

      standings.slice(0, advanceCount).forEach((player, idx) => {
        qualifiedPlayers.push({ name: player.name, group: group.name, rank: idx + 1 })
      })
    })

    // Generate bracket matches with IBSA cross-seeding
    const bracketMatches: Match[] = []
    const roundNames = ['8강', '4강', '결승']
    let matchId = (project.matches?.length || 0) + 1

    // First round: Cross-seed (1A vs 2B, 1B vs 2A, etc.)
    for (let i = 0; i < Math.min(bracketSize / 2, 4); i++) {
      const groupIdx1 = i % groups.length
      const groupIdx2 = (i + 1) % groups.length
      const player1 = qualifiedPlayers.find(p => p.group === groups[groupIdx1]?.name && p.rank === 1)
      const player2 = qualifiedPlayers.find(p => p.group === groups[groupIdx2]?.name && p.rank === 2)

      bracketMatches.push({
        id: matchId++,
        player1Name: player1?.name || 'TBD',
        player2Name: player2?.name || 'TBD',
        status: 'pending',
        sets: [],
        setsToWin: project.tournamentSettings?.setsPerMatch || 2,
        currentSet: 1,
        currentServer: 1,
        bracketRound: 1,
        bracketMatchNum: i + 1,
        roundName: roundNames[0]
      })
    }

    // Subsequent rounds (empty)
    let currentRound = 2
    let matchesInRound = bracketSize / 4
    while (matchesInRound >= 1) {
      for (let i = 0; i < matchesInRound; i++) {
        bracketMatches.push({
          id: matchId++,
          player1Name: 'TBD',
          player2Name: 'TBD',
          status: 'waiting',
          sets: [],
          setsToWin: project.tournamentSettings?.setsPerMatch || 2,
          currentSet: 1,
          currentServer: 1,
          bracketRound: currentRound,
          bracketMatchNum: i + 1,
          roundName: matchesInRound === 1 ? '결승' : matchesInRound === 2 ? '4강' : `${matchesInRound * 2}강`
        })
      }
      currentRound++
      matchesInRound = Math.floor(matchesInRound / 2)
    }

    await update(ref(database, `projects/${id}`), {
      matches: [...(project.matches || []), ...bracketMatches],
      tournamentSettings: { ...project.tournamentSettings, size: bracketSize }
    })
  }

  if (!project) return <div className="container"><div className="loading">불러오는 중...</div></div>

  const bracketMatches = (project.matches || []).filter(m => m.bracketRound)

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate(`/project/${id}`)}>← 뒤로</button>
        <h1>토너먼트 브라켓</h1>
      </header>

      <main>
        {bracketMatches.length === 0 ? (
          <>
            <div className="form-group">
              <label>브라켓 크기</label>
              <select value={bracketSize} onChange={(e) => setBracketSize(parseInt(e.target.value))}>
                {[4, 8, 16].map(n => (
                  <option key={n} value={n}>{n}강</option>
                ))}
              </select>
            </div>
            <button className="primary-btn" onClick={generateBracket}>
              🏆 브라켓 생성
            </button>
          </>
        ) : (
          <div className="bracket-view">
            {Object.entries(
              bracketMatches.reduce((acc, m) => {
                const round = m.bracketRound || 1
                if (!acc[round]) acc[round] = []
                acc[round].push(m)
                return acc
              }, {} as Record<number, Match[]>)
            ).sort(([a], [b]) => parseInt(a) - parseInt(b))
              .map(([round, matches]) => (
                <div key={round} className="bracket-round">
                  <div className="round-header">{matches[0]?.roundName || `${round}R`}</div>
                  {matches.map(match => (
                    <div key={match.id} className={`bracket-match ${match.status}`}>
                      <div className={`bracket-player ${match.winner === 1 ? 'winner' : ''}`}>
                        {match.player1Name}
                        {match.status === 'completed' && <span>{match.player1Sets}</span>}
                      </div>
                      <div className={`bracket-player ${match.winner === 2 ? 'winner' : ''}`}>
                        {match.player2Name}
                        {match.status === 'completed' && <span>{match.player2Sets}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </main>
    </div>
  )
}

// App
function App() {
  return (
    <BrowserRouter basename="/showdown-test/admin-app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateProject />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/project/:id/players" element={<ManagePlayers />} />
        <Route path="/project/:id/groups" element={<ManageGroups />} />
        <Route path="/project/:id/matches" element={<ManageMatches />} />
        <Route path="/project/:id/bracket" element={<ManageBracket />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
