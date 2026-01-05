import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Header, Card, Button, Modal } from '@/components/common'
import { ScoreBoard, ScoreButtons, SetScoreDisplay } from '@/components/match'
import { useMatchScoring } from '@/hooks'
import { useProjectStore, useMatchStore } from '@/stores'
import type { Match as MatchType } from '@/types'
import styles from './Match.module.css'

export function Match() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')

  const projects = useProjectStore((state) => state.projects)
  const updateProject = useProjectStore((state) => state.updateProject)
  const scoreHistory = useMatchStore((state) => state.scoreHistory)
  const clearHistory = useMatchStore((state) => state.clearHistory)

  const [showEndModal, setShowEndModal] = useState(false)
  const [showExitModal, setShowExitModal] = useState(false)

  const {
    currentMatch,
    addScore,
    undo,
    startMatch,
    endMatch,
    getCurrentSetScores,
    getPointStatus,
  } = useMatchScoring()

  // Load match from project
  useEffect(() => {
    if (id && projectId) {
      const project = projects.find((p) => p.id === parseInt(projectId))
      if (project) {
        const match = project.matches?.find((m) => m.id === parseInt(id))
        if (match) {
          startMatch(match)
          clearHistory()
          return
        }
      }
    }
    // Match not found
    navigate('/referee')
  }, [id, projectId, projects, startMatch, clearHistory, navigate])

  // Save match to project when it changes
  const saveMatch = useCallback(
    (match: MatchType) => {
      if (!projectId) return

      const project = projects.find((p) => p.id === parseInt(projectId))
      if (!project) return

      const updatedMatches = project.matches?.map((m) =>
        m.id === match.id ? match : m
      ) || []

      updateProject(parseInt(projectId), { matches: updatedMatches })
    },
    [projectId, projects, updateProject]
  )

  // Handle score addition
  const handleScore = useCallback(
    (player: 1 | 2) => {
      const updatedMatch = addScore(player)
      if (updatedMatch) {
        saveMatch(updatedMatch)

        // Check if match ended
        if (updatedMatch.status === 'completed') {
          setShowEndModal(true)
        }
      }
    },
    [addScore, saveMatch]
  )

  // Handle undo
  const handleUndo = useCallback(() => {
    const updatedMatch = undo()
    if (updatedMatch) {
      saveMatch(updatedMatch)
    }
  }, [undo, saveMatch])

  // Handle forfeit/end match
  const handleEndMatch = useCallback(
    (winner?: 1 | 2) => {
      const updatedMatch = endMatch(winner, winner ? '기권' : '경기 종료')
      if (updatedMatch) {
        saveMatch(updatedMatch)
        setShowEndModal(true)
      }
    },
    [endMatch, saveMatch]
  )

  // Navigate back to project
  const handleBackToProject = useCallback(() => {
    if (projectId) {
      navigate(`/admin/project/${projectId}`)
    } else {
      navigate('/referee')
    }
  }, [navigate, projectId])

  // Handle exit confirmation
  const handleExitRequest = useCallback(() => {
    if (currentMatch?.status === 'active') {
      setShowExitModal(true)
    } else {
      handleBackToProject()
    }
  }, [currentMatch, handleBackToProject])

  if (!currentMatch) {
    return (
      <div className={styles.container}>
        <Card>
          <p>경기를 불러오는 중...</p>
        </Card>
      </div>
    )
  }

  const currentSetScores = getCurrentSetScores()
  const pointStatus = getPointStatus()
  const isMatchComplete = currentMatch.status === 'completed'

  return (
    <div className={styles.container}>
      <Header
        title="경기 진행"
        subtitle={`${currentMatch.player1Name} vs ${currentMatch.player2Name}`}
        gradient="linear-gradient(135deg, #4caf50 0%, #388e3c 100%)"
        showBack
        onBack={handleExitRequest}
      />

      <main className={styles.main}>
        {/* Score Board */}
        <ScoreBoard
          match={currentMatch}
          currentSetScores={currentSetScores}
          pointStatus={pointStatus}
        />

        {/* Score Buttons */}
        {!isMatchComplete && (
          <Card>
            <ScoreButtons
              player1Name={currentMatch.player1Name || '선수 1'}
              player2Name={currentMatch.player2Name || '선수 2'}
              onScore={handleScore}
              onUndo={handleUndo}
              canUndo={scoreHistory.length > 0}
            />
          </Card>
        )}

        {/* Set Scores */}
        {currentMatch.sets && currentMatch.sets.length > 0 && (
          <SetScoreDisplay
            sets={currentMatch.sets}
            player1Name={currentMatch.player1Name || '선수 1'}
            player2Name={currentMatch.player2Name || '선수 2'}
            currentSet={currentMatch.currentSet || 1}
          />
        )}

        {/* Match Actions */}
        <Card>
          <div className={styles.actions}>
            {!isMatchComplete ? (
              <>
                <Button
                  variant="danger"
                  onClick={() => handleEndMatch(2)}
                >
                  {currentMatch.player1Name} 기권
                </Button>
                <Button
                  variant="danger"
                  onClick={() => handleEndMatch(1)}
                >
                  {currentMatch.player2Name} 기권
                </Button>
              </>
            ) : (
              <div className={styles.matchResult}>
                <h3>경기 종료</h3>
                <p className={styles.winner}>
                  🏆 승자: {currentMatch.winner === 1 ? currentMatch.player1Name : currentMatch.player2Name}
                </p>
                <p className={styles.finalScore}>
                  최종 스코어: {currentMatch.player1Sets || 0} - {currentMatch.player2Sets || 0}
                </p>
                <Button variant="primary" onClick={handleBackToProject}>
                  대회로 돌아가기
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Back Button */}
        <Card>
          <Button onClick={handleExitRequest}>
            ← 뒤로 가기
          </Button>
        </Card>
      </main>

      {/* Match End Modal */}
      <Modal
        isOpen={showEndModal && isMatchComplete}
        onClose={() => setShowEndModal(false)}
        title="경기 종료"
      >
        <div className={styles.endModalContent}>
          <div className={styles.trophyIcon}>🏆</div>
          <h2>
            {currentMatch.winner === 1
              ? currentMatch.player1Name
              : currentMatch.player2Name}{' '}
            승리!
          </h2>
          <p>
            최종 스코어: {currentMatch.player1Sets || 0} - {currentMatch.player2Sets || 0}
          </p>
          <Button variant="primary" onClick={handleBackToProject}>
            확인
          </Button>
        </div>
      </Modal>

      {/* Exit Confirmation Modal */}
      <Modal
        isOpen={showExitModal}
        onClose={() => setShowExitModal(false)}
        title="경기 나가기"
      >
        <div className={styles.exitModalContent}>
          <p>경기가 진행 중입니다. 나가시겠습니까?</p>
          <p className={styles.warning}>진행 상황은 저장됩니다.</p>
          <div className={styles.modalButtons}>
            <Button onClick={() => setShowExitModal(false)}>
              취소
            </Button>
            <Button variant="primary" onClick={handleBackToProject}>
              나가기
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
