import { useState, useEffect, useCallback } from 'react'
import { HashRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { database, ref, onValue, update } from './firebase'
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
        <h1>심판 모드</h1>
        <p>경기를 선택하여 점수를 기록하세요</p>
      </header>
      <main>
        {projects.length === 0 ? (
          <div className="empty">등록된 대회가 없습니다</div>
        ) : (
          projects.map(project => {
            const ready = (project.matches || []).filter(m => m.status === 'ready' || m.status === 'active').length
            return (
              <div key={project.firebaseKey} className="card" onClick={() => navigate(`/project/${project.firebaseKey}`)}>
                <div className="card-header">
                  <h2>{project.name}</h2>
                  {ready > 0 && <span className="badge">{ready} 경기</span>}
                </div>
                <p className="meta">{project.date} • {project.location || '장소 미정'}</p>
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

  useEffect(() => {
    if (!id) return
    return onValue(ref(database, `projects/${id}`), (snapshot) => {
      const data = snapshot.val()
      if (data) setProject({ ...data, firebaseKey: id })
    })
  }, [id])

  if (!project) return <div className="container"><div className="loading">로딩 중...</div></div>

  const readyMatches = (project.matches || []).filter(m => m.status === 'ready')
  const activeMatches = (project.matches || []).filter(m => m.status === 'active')

  return (
    <div className="container">
      <header className="header small">
        <button className="back" onClick={() => navigate('/')}>←</button>
        <div>
          <h1>{project.name}</h1>
          <p>경기 선택</p>
        </div>
      </header>
      <main>
        {activeMatches.length > 0 && (
          <>
            <h3 className="section-title">진행 중</h3>
            {activeMatches.map(m => (
              <div key={m.id} className="card active" onClick={() => navigate(`/match/${project.firebaseKey}/${m.id}`)}>
                <div className="match-info">
                  <span className="badge live">LIVE</span>
                  <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                </div>
                <div className="match-players">
                  <span>{m.player1Name}</span>
                  <span className="score">{m.player1Sets || 0} - {m.player2Sets || 0}</span>
                  <span>{m.player2Name}</span>
                </div>
              </div>
            ))}
          </>
        )}
        {readyMatches.length > 0 && (
          <>
            <h3 className="section-title">대기 중</h3>
            {readyMatches.map(m => (
              <div key={m.id} className="card" onClick={() => navigate(`/match/${project.firebaseKey}/${m.id}`)}>
                <div className="match-info">
                  <span className="group">{m.groupName ? `${m.groupName}조` : m.roundName}</span>
                </div>
                <div className="match-players">
                  <span>{m.player1Name}</span>
                  <span className="vs">VS</span>
                  <span>{m.player2Name}</span>
                </div>
              </div>
            ))}
          </>
        )}
        {readyMatches.length === 0 && activeMatches.length === 0 && (
          <div className="empty">진행 가능한 경기가 없습니다</div>
        )}
      </main>
    </div>
  )
}

function MatchView() {
  const { projectId, matchId } = useParams()
  const navigate = useNavigate()
  const [match, setMatch] = useState<Match | null>(null)
  const [matchIndex, setMatchIndex] = useState<number>(-1)
  const [voiceEnabled, setVoiceEnabled] = useState(false)

  useEffect(() => {
    if (!projectId) return
    return onValue(ref(database, `projects/${projectId}/matches`), (snapshot) => {
      const data = snapshot.val()
      if (data && matchId) {
        const idx = data.findIndex((m: Match) => m.id === parseInt(matchId))
        if (idx !== -1) {
          setMatch(data[idx])
          setMatchIndex(idx)
        }
      }
    })
  }, [projectId, matchId])

  const speak = useCallback((text: string) => {
    if (voiceEnabled && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'ko-KR'
      utterance.rate = 0.9
      speechSynthesis.speak(utterance)
    }
  }, [voiceEnabled])

  const updateMatch = useCallback(async (updates: Partial<Match>) => {
    if (!projectId || matchIndex === -1) return
    await update(ref(database, `projects/${projectId}/matches/${matchIndex}`), updates)
  }, [projectId, matchIndex])

  const startMatch = async () => {
    if (!match) return
    const initialSets = [{ player1Score: 0, player2Score: 0, isComplete: false }]
    await updateMatch({
      status: 'active',
      sets: initialSets,
      currentSet: 1,
      player1Sets: 0,
      player2Sets: 0
    })
    speak('경기 시작')
  }

  const addScore = async (player: 1 | 2) => {
    if (!match || match.status !== 'active') return

    const sets = [...(match.sets || [])]
    const currentSetIndex = (match.currentSet || 1) - 1

    if (!sets[currentSetIndex]) {
      sets[currentSetIndex] = { player1Score: 0, player2Score: 0, isComplete: false }
    }

    const currentSet = { ...sets[currentSetIndex] }
    if (player === 1) currentSet.player1Score++
    else currentSet.player2Score++

    sets[currentSetIndex] = currentSet

    const p1Score = currentSet.player1Score
    const p2Score = currentSet.player2Score
    speak(`${p1Score} 대 ${p2Score}`)

    const isSetWin = (p1Score >= 11 || p2Score >= 11) && Math.abs(p1Score - p2Score) >= 2

    if (isSetWin) {
      currentSet.isComplete = true
      currentSet.winner = p1Score > p2Score ? 1 : 2
      sets[currentSetIndex] = currentSet

      const newP1Sets = (match.player1Sets || 0) + (currentSet.winner === 1 ? 1 : 0)
      const newP2Sets = (match.player2Sets || 0) + (currentSet.winner === 2 ? 1 : 0)

      const setsToWin = match.setsToWin || 3

      if (newP1Sets >= setsToWin || newP2Sets >= setsToWin) {
        const winner = newP1Sets >= setsToWin ? 1 : 2
        const winnerName = winner === 1 ? match.player1Name : match.player2Name
        speak(`경기 종료. ${winnerName} 승리`)

        await updateMatch({
          sets,
          player1Sets: newP1Sets,
          player2Sets: newP2Sets,
          status: 'completed',
          winner
        })
      } else {
        speak(`세트 종료. ${newP1Sets} 대 ${newP2Sets}`)
        sets.push({ player1Score: 0, player2Score: 0, isComplete: false })

        await updateMatch({
          sets,
          player1Sets: newP1Sets,
          player2Sets: newP2Sets,
          currentSet: (match.currentSet || 1) + 1
        })
      }
    } else {
      await updateMatch({ sets })
    }
  }

  const undoScore = async () => {
    if (!match || match.status !== 'active') return

    const sets = [...(match.sets || [])]
    const currentSetIndex = (match.currentSet || 1) - 1
    const currentSet = sets[currentSetIndex]

    if (!currentSet) return

    if (currentSet.player1Score === 0 && currentSet.player2Score === 0) {
      if (currentSetIndex > 0) {
        sets.pop()
        const prevSet = sets[currentSetIndex - 1]
        prevSet.isComplete = false
        prevSet.winner = undefined

        await updateMatch({
          sets,
          currentSet: match.currentSet! - 1,
          player1Sets: Math.max(0, (match.player1Sets || 0) - (prevSet.player1Score > prevSet.player2Score ? 1 : 0)),
          player2Sets: Math.max(0, (match.player2Sets || 0) - (prevSet.player2Score > prevSet.player1Score ? 1 : 0))
        })
      }
      return
    }

    if (currentSet.player1Score > currentSet.player2Score) {
      currentSet.player1Score--
    } else if (currentSet.player2Score > currentSet.player1Score) {
      currentSet.player2Score--
    } else if (currentSet.player1Score > 0) {
      currentSet.player1Score--
    }

    sets[currentSetIndex] = currentSet
    await updateMatch({ sets })
    speak('취소')
  }

  if (!match) return <div className="container"><div className="loading">로딩 중...</div></div>

  const currentSet = match.sets?.[(match.currentSet || 1) - 1]

  return (
    <div className="container scoring">
      <header className="header small">
        <button className="back" onClick={() => navigate(`/project/${projectId}`)}>←</button>
        <div>
          <span className="group">{match.groupName ? `${match.groupName}조` : match.roundName}</span>
          <button
            className={`voice-btn ${voiceEnabled ? 'active' : ''}`}
            onClick={() => setVoiceEnabled(!voiceEnabled)}
          >
            {voiceEnabled ? '🔊' : '🔇'}
          </button>
        </div>
      </header>

      <main>
        {match.status === 'ready' ? (
          <div className="start-screen">
            <div className="players-preview">
              <div className="player-name">{match.player1Name}</div>
              <div className="vs-large">VS</div>
              <div className="player-name">{match.player2Name}</div>
            </div>
            <button className="start-btn" onClick={startMatch}>경기 시작</button>
          </div>
        ) : match.status === 'completed' ? (
          <div className="result-screen">
            <h2>경기 종료</h2>
            <div className="final-score">
              <div className={match.winner === 1 ? 'winner' : ''}>
                <span className="name">{match.player1Name}</span>
                <span className="sets">{match.player1Sets}</span>
              </div>
              <span className="divider">-</span>
              <div className={match.winner === 2 ? 'winner' : ''}>
                <span className="sets">{match.player2Sets}</span>
                <span className="name">{match.player2Name}</span>
              </div>
            </div>
            <button className="back-btn" onClick={() => navigate(`/project/${projectId}`)}>목록으로</button>
          </div>
        ) : (
          <>
            <div className="set-score">
              <span>세트 {match.currentSet}</span>
              <span className="sets-display">{match.player1Sets || 0} - {match.player2Sets || 0}</span>
            </div>

            <div className="score-board">
              <div className="player-section" onClick={() => addScore(1)}>
                <div className="player-name">{match.player1Name}</div>
                <div className="current-score">{currentSet?.player1Score || 0}</div>
              </div>
              <div className="divider-line"></div>
              <div className="player-section" onClick={() => addScore(2)}>
                <div className="player-name">{match.player2Name}</div>
                <div className="current-score">{currentSet?.player2Score || 0}</div>
              </div>
            </div>

            <div className="controls">
              <button className="undo-btn" onClick={undoScore}>↩ 취소</button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/project/:id" element={<ProjectView />} />
        <Route path="/match/:projectId/:matchId" element={<MatchView />} />
      </Routes>
    </HashRouter>
  )
}
