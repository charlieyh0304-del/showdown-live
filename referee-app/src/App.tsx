import { useState, useEffect, useCallback } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { database, ref, onValue, update } from './firebase'
import { useMatchScoring } from './hooks/useMatchScoring'
import { useAccessibilityStore } from './stores/useAccessibilityStore'
import { useMatchStore } from './stores/useMatchStore'
import { useSpeech } from './hooks/useSpeech'
import type { Project, Match } from './types'
import './App.css'

// 홈 - 대회/경기 선택
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
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const getReadyMatches = (project: Project) => {
    return (project.matches || []).filter(
      m => m.status === 'pending' || m.status === 'ready' || m.status === 'active'
    )
  }

  if (loading) {
    return <div className="container"><div className="loading">대회 불러오는 중...</div></div>
  }

  return (
    <div className="container">
      <header className="header">
        <h1>🏓 심판 모드</h1>
        <p>경기를 선택하여 진행하세요</p>
        <button className="settings-btn" onClick={() => navigate('/settings')}>
          ⚙️ 설정
        </button>
      </header>

      <main>
        {projects.length === 0 ? (
          <div className="empty">등록된 대회가 없습니다.</div>
        ) : (
          projects.map(project => {
            const matches = getReadyMatches(project)
            if (matches.length === 0) return null

            return (
              <div key={project.firebaseKey} className="card project-card">
                <h2>{project.name}</h2>
                <p className="project-meta">{project.date} • {project.location || '장소 미정'}</p>

                <div className="match-list">
                  {matches.map(match => (
                    <button
                      key={match.id}
                      className={`match-item ${match.status}`}
                      onClick={() => navigate(`/match/${project.firebaseKey}/${match.id}`)}
                    >
                      <span className="match-players">
                        {match.player1Name} vs {match.player2Name}
                      </span>
                      <span className="match-info">
                        {match.groupName ? `${match.groupName}조` : match.roundName || ''}
                        {match.status === 'active' && <span className="live-badge">진행중</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}

// 경기 진행
function MatchPage() {
  const navigate = useNavigate()
  const { projectId, matchId } = useParams<{ projectId: string; matchId: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEndModal, setShowEndModal] = useState(false)

  const { currentMatch, addScore, undo, startMatch, endMatch, getCurrentSetScores, clearHistory } = useMatchScoring()
  const scoreHistory = useMatchStore(state => state.scoreHistory)

  // Firebase에서 프로젝트 로드
  useEffect(() => {
    if (!projectId) return

    const projectRef = ref(database, `projects/${projectId}`)
    const unsubscribe = onValue(projectRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        setProject({ ...data, firebaseKey: projectId })
      }
      setLoading(false)
    }, { onlyOnce: true })

    return () => unsubscribe()
  }, [projectId])

  // 경기 시작
  useEffect(() => {
    if (project && matchId && !currentMatch) {
      const match = project.matches?.find(m => m.id === parseInt(matchId))
      if (match) {
        startMatch(match)
        clearHistory()
      }
    }
  }, [project, matchId, currentMatch, startMatch, clearHistory])

  // Firebase에 경기 상태 저장
  const saveToFirebase = useCallback((match: Match) => {
    if (!projectId || !project) return

    const updatedMatches = project.matches?.map(m =>
      m.id === match.id ? match : m
    ) || []

    update(ref(database, `projects/${projectId}`), { matches: updatedMatches })
  }, [projectId, project])

  const handleScore = useCallback((player: 1 | 2) => {
    const updated = addScore(player)
    if (updated) {
      saveToFirebase(updated)
      if (updated.status === 'completed') {
        setShowEndModal(true)
      }
    }
  }, [addScore, saveToFirebase])

  const handleUndo = useCallback(() => {
    const updated = undo()
    if (updated) saveToFirebase(updated)
  }, [undo, saveToFirebase])

  const handleForfeit = useCallback((winner: 1 | 2) => {
    const updated = endMatch(winner)
    if (updated) {
      saveToFirebase(updated)
      setShowEndModal(true)
    }
  }, [endMatch, saveToFirebase])

  if (loading || !currentMatch) {
    return <div className="container"><div className="loading">경기 불러오는 중...</div></div>
  }

  const scores = getCurrentSetScores()
  const isComplete = currentMatch.status === 'completed'

  return (
    <div className="container match-container">
      {/* 헤더 */}
      <header className="match-header">
        <button className="back-btn" onClick={() => navigate('/')}>← 목록</button>
        <span className="match-stage">
          {currentMatch.groupName ? `${currentMatch.groupName}조` : currentMatch.roundName || '경기'}
        </span>
        <span className="set-info">세트 {currentMatch.currentSet}/{currentMatch.setsToWin * 2 - 1}</span>
      </header>

      {/* 스코어보드 */}
      <div className="scoreboard">
        <div className={`player-section ${currentMatch.currentServer === 1 ? 'serving' : ''}`}>
          <div className="player-name">{currentMatch.player1Name}</div>
          <div className="set-score">{currentMatch.player1Sets || 0}</div>
          <div className="point-score">{scores.player1Score}</div>
          {currentMatch.currentServer === 1 && <div className="serve-indicator">서브</div>}
        </div>

        <div className="vs">VS</div>

        <div className={`player-section right ${currentMatch.currentServer === 2 ? 'serving' : ''}`}>
          <div className="player-name">{currentMatch.player2Name}</div>
          <div className="set-score">{currentMatch.player2Sets || 0}</div>
          <div className="point-score">{scores.player2Score}</div>
          {currentMatch.currentServer === 2 && <div className="serve-indicator">서브</div>}
        </div>
      </div>

      {/* 득점 버튼 */}
      {!isComplete && (
        <div className="score-buttons">
          <button className="score-btn player1" onClick={() => handleScore(1)}>
            {currentMatch.player1Name}<br />득점
          </button>
          <button className="score-btn player2" onClick={() => handleScore(2)}>
            {currentMatch.player2Name}<br />득점
          </button>
        </div>
      )}

      {/* 취소 버튼 */}
      {!isComplete && scoreHistory.length > 0 && (
        <button className="undo-btn" onClick={handleUndo}>
          ↩ 실행 취소
        </button>
      )}

      {/* 세트 기록 */}
      {currentMatch.sets && currentMatch.sets.length > 0 && (
        <div className="set-history">
          <h3>세트 기록</h3>
          <div className="set-list">
            {currentMatch.sets.map((set, idx) => (
              <div key={idx} className={`set-item ${set.isComplete ? 'complete' : ''} ${idx === currentMatch.currentSet - 1 ? 'current' : ''}`}>
                <span>세트 {idx + 1}</span>
                <span className="set-result">{set.player1Score} - {set.player2Score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 기권 버튼 */}
      {!isComplete && (
        <div className="forfeit-buttons">
          <button className="forfeit-btn" onClick={() => handleForfeit(2)}>
            {currentMatch.player1Name} 기권
          </button>
          <button className="forfeit-btn" onClick={() => handleForfeit(1)}>
            {currentMatch.player2Name} 기권
          </button>
        </div>
      )}

      {/* 경기 종료 결과 */}
      {isComplete && (
        <div className="match-result">
          <div className="trophy">🏆</div>
          <h2>{currentMatch.winner === 1 ? currentMatch.player1Name : currentMatch.player2Name} 승리!</h2>
          <p>최종: {currentMatch.player1Sets} - {currentMatch.player2Sets}</p>
          <button className="primary-btn" onClick={() => navigate('/')}>
            목록으로
          </button>
        </div>
      )}

      {/* 종료 모달 */}
      {showEndModal && isComplete && (
        <div className="modal-overlay" onClick={() => setShowEndModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="trophy">🏆</div>
            <h2>{currentMatch.winner === 1 ? currentMatch.player1Name : currentMatch.player2Name} 승리!</h2>
            <p>{currentMatch.player1Sets} - {currentMatch.player2Sets}</p>
            <button className="primary-btn" onClick={() => navigate('/')}>확인</button>
          </div>
        </div>
      )}
    </div>
  )
}

// 설정 페이지
function Settings() {
  const navigate = useNavigate()
  const {
    voiceEnabled, voiceVolume, theme, fontSize, reduceMotion,
    announceScore, announceSetScore, announceServe,
    setVoiceEnabled, setVoiceVolume, setTheme, setFontSize,
    setReduceMotion, setAnnounceScore, setAnnounceSetScore, setAnnounceServe
  } = useAccessibilityStore()
  const { speak, isSupported } = useSpeech()

  const handleVoiceToggle = () => {
    const newValue = !voiceEnabled
    setVoiceEnabled(newValue)
    if (newValue) {
      setTimeout(() => speak('음성 안내가 활성화되었습니다.'), 100)
    }
  }

  return (
    <div className="container">
      <header className="header small">
        <button className="back-btn" onClick={() => navigate('/')}>← 뒤로</button>
        <h1>접근성 설정</h1>
      </header>

      <main className="settings-main">
        {/* 음성 설정 */}
        <section className="setting-section">
          <h2>🔊 음성 안내</h2>

          <div className="setting-item">
            <span>음성 안내 사용</span>
            <button
              className={`toggle ${voiceEnabled ? 'active' : ''}`}
              onClick={handleVoiceToggle}
              disabled={!isSupported}
            >
              {voiceEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {!isSupported && (
            <p className="warning">이 브라우저는 음성 합성을 지원하지 않습니다.</p>
          )}

          {voiceEnabled && (
            <>
              <div className="setting-item">
                <span>음량</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={voiceVolume}
                  onChange={(e) => setVoiceVolume(parseFloat(e.target.value))}
                />
                <span>{Math.round(voiceVolume * 100)}%</span>
              </div>

              <button className="test-btn" onClick={() => speak('테스트 음성입니다. 3 대 2')}>
                음성 테스트
              </button>

              <div className="checkbox-group">
                <label>
                  <input type="checkbox" checked={announceScore} onChange={e => setAnnounceScore(e.target.checked)} />
                  매 득점 시 안내
                </label>
                <label>
                  <input type="checkbox" checked={announceSetScore} onChange={e => setAnnounceSetScore(e.target.checked)} />
                  세트 점수 안내
                </label>
                <label>
                  <input type="checkbox" checked={announceServe} onChange={e => setAnnounceServe(e.target.checked)} />
                  서브 교대 안내
                </label>
              </div>
            </>
          )}
        </section>

        {/* 시각 설정 */}
        <section className="setting-section">
          <h2>👁️ 시각 설정</h2>

          <div className="setting-item">
            <span>테마</span>
          </div>
          <div className="theme-buttons">
            {(['default', 'dark', 'high-contrast', 'inverted'] as const).map(t => (
              <button
                key={t}
                className={`theme-btn ${theme === t ? 'selected' : ''}`}
                onClick={() => setTheme(t)}
              >
                <span className={`theme-preview ${t}`} />
                {t === 'default' ? '기본' : t === 'dark' ? '다크' : t === 'high-contrast' ? '고대비' : '반전'}
              </button>
            ))}
          </div>

          <div className="setting-item">
            <span>글꼴 크기</span>
          </div>
          <div className="font-buttons">
            {(['normal', 'large', 'extra-large'] as const).map(f => (
              <button
                key={f}
                className={`font-btn ${f} ${fontSize === f ? 'selected' : ''}`}
                onClick={() => setFontSize(f)}
              >
                가
              </button>
            ))}
          </div>

          <div className="setting-item">
            <label>
              <input type="checkbox" checked={reduceMotion} onChange={e => setReduceMotion(e.target.checked)} />
              애니메이션 줄이기
            </label>
          </div>
        </section>
      </main>
    </div>
  )
}

// 접근성 Provider
function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const { theme, fontSize, reduceMotion } = useAccessibilityStore()

  useEffect(() => {
    const body = document.body
    body.classList.remove('default', 'dark', 'high-contrast', 'inverted')
    if (theme !== 'default') body.classList.add(theme)

    body.classList.remove('font-normal', 'font-large', 'font-extra-large')
    if (fontSize !== 'normal') body.classList.add(`font-${fontSize}`)

    if (reduceMotion) body.classList.add('reduce-motion')
    else body.classList.remove('reduce-motion')
  }, [theme, fontSize, reduceMotion])

  return <>{children}</>
}

// 앱
function App() {
  return (
    <AccessibilityProvider>
      <BrowserRouter basename="/showdown-test/referee-app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/match/:projectId/:matchId" element={<MatchPage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </AccessibilityProvider>
  )
}

export default App
