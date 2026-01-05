import { useUIStore } from '@/stores/useUIStore'
import styles from './OfflineIndicator.module.css'

export function OfflineIndicator() {
  const isOffline = useUIStore((state) => state.isOffline)

  if (!isOffline) return null

  return (
    <div className={styles.indicator} role="status" aria-live="polite">
      <span className={styles.dot}></span>
      오프라인 상태
    </div>
  )
}
