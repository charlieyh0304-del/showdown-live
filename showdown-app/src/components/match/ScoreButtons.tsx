import styles from './ScoreButtons.module.css'

interface ScoreButtonsProps {
  player1Name: string
  player2Name: string
  onScore: (player: 1 | 2) => void
  onUndo: () => void
  disabled?: boolean
  canUndo?: boolean
}

export function ScoreButtons({
  player1Name,
  player2Name,
  onScore,
  onUndo,
  disabled = false,
  canUndo = false,
}: ScoreButtonsProps) {
  return (
    <div className={styles.container}>
      <div className={styles.scoreButtonsRow}>
        <button
          className={`${styles.scoreButton} ${styles.player1}`}
          onClick={() => onScore(1)}
          disabled={disabled}
          aria-label={`${player1Name} 득점`}
        >
          <span className={styles.buttonLabel}>{player1Name}</span>
          <span className={styles.buttonAction}>+1</span>
        </button>

        <button
          className={`${styles.scoreButton} ${styles.player2}`}
          onClick={() => onScore(2)}
          disabled={disabled}
          aria-label={`${player2Name} 득점`}
        >
          <span className={styles.buttonLabel}>{player2Name}</span>
          <span className={styles.buttonAction}>+1</span>
        </button>
      </div>

      <button
        className={styles.undoButton}
        onClick={onUndo}
        disabled={!canUndo || disabled}
        aria-label="실행 취소"
      >
        ↩ 실행 취소
      </button>
    </div>
  )
}
