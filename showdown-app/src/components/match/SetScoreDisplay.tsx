import type { SetScore } from '@/types'
import styles from './SetScoreDisplay.module.css'

interface SetScoreDisplayProps {
  sets: SetScore[]
  player1Name: string
  player2Name: string
  currentSet: number
}

export function SetScoreDisplay({
  sets,
  player1Name,
  player2Name,
  currentSet,
}: SetScoreDisplayProps) {
  if (!sets || sets.length === 0) {
    return null
  }

  return (
    <div className={styles.container}>
      <h4 className={styles.title}>세트 스코어</h4>
      <div className={styles.table}>
        <div className={styles.header}>
          <div className={styles.playerCell}></div>
          {sets.map((_, index) => (
            <div
              key={index}
              className={`${styles.setCell} ${index + 1 === currentSet ? styles.current : ''}`}
            >
              {index + 1}
            </div>
          ))}
        </div>

        {/* Player 1 row */}
        <div className={styles.row}>
          <div className={styles.playerCell}>{player1Name}</div>
          {sets.map((set, index) => (
            <div
              key={index}
              className={`${styles.scoreCell} ${
                set.winner === 1 ? styles.winner : ''
              } ${index + 1 === currentSet ? styles.current : ''}`}
            >
              {set.player1Score}
            </div>
          ))}
        </div>

        {/* Player 2 row */}
        <div className={styles.row}>
          <div className={styles.playerCell}>{player2Name}</div>
          {sets.map((set, index) => (
            <div
              key={index}
              className={`${styles.scoreCell} ${
                set.winner === 2 ? styles.winner : ''
              } ${index + 1 === currentSet ? styles.current : ''}`}
            >
              {set.player2Score}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
