import type { Match } from '@/types'
import styles from './ScoreBoard.module.css'

interface ScoreBoardProps {
  match: Match
  currentSetScores: { player1: number; player2: number }
  pointStatus: { type: string; player: number | null } | null
}

export function ScoreBoard({ match, currentSetScores, pointStatus }: ScoreBoardProps) {
  const getStatusText = () => {
    if (!pointStatus) return null

    switch (pointStatus.type) {
      case 'matchPoint':
        return `매치 포인트 - ${pointStatus.player === 1 ? match.player1Name : match.player2Name}`
      case 'setPoint':
        return `세트 포인트 - ${pointStatus.player === 1 ? match.player1Name : match.player2Name}`
      case 'deuce':
        return '듀스'
      default:
        return null
    }
  }

  const statusText = getStatusText()

  return (
    <div className={styles.scoreBoard}>
      {/* Set indicator */}
      <div className={styles.setIndicator}>
        제 {match.currentSet || 1} 세트
      </div>

      {/* Main scores */}
      <div className={styles.scoresContainer}>
        {/* Player 1 */}
        <div className={`${styles.playerScore} ${match.currentServer === 1 ? styles.serving : ''}`}>
          <div className={styles.playerName}>
            {match.currentServer === 1 && <span className={styles.serveIcon}>●</span>}
            {match.player1Name || '선수 1'}
          </div>
          <div className={styles.score}>{currentSetScores.player1}</div>
          <div className={styles.setsWon}>
            세트: {match.player1Sets || 0}
          </div>
        </div>

        {/* VS */}
        <div className={styles.versus}>
          <span>VS</span>
        </div>

        {/* Player 2 */}
        <div className={`${styles.playerScore} ${match.currentServer === 2 ? styles.serving : ''}`}>
          <div className={styles.playerName}>
            {match.currentServer === 2 && <span className={styles.serveIcon}>●</span>}
            {match.player2Name || '선수 2'}
          </div>
          <div className={styles.score}>{currentSetScores.player2}</div>
          <div className={styles.setsWon}>
            세트: {match.player2Sets || 0}
          </div>
        </div>
      </div>

      {/* Status message */}
      {statusText && (
        <div className={`${styles.statusMessage} ${styles[pointStatus?.type || '']}`}>
          {statusText}
        </div>
      )}
    </div>
  )
}
