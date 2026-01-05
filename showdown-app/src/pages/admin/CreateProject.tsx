import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header, Card, Button, Input, Select } from '@/components/common'
import { useProjectStore } from '@/stores'
import { useFirebase } from '@/hooks'
import type { Project, CompetitionType, TournamentType } from '@/types'
import styles from './CreateProject.module.css'

type SimpleTournamentType = 'free' | 'group' | 'tournament' | 'group-tournament'

export function CreateProject() {
  const navigate = useNavigate()
  const addProject = useProjectStore((state) => state.addProject)
  const { syncProject } = useFirebase()

  // Form state
  const [name, setName] = useState('')
  const [competitionType, setCompetitionType] = useState<CompetitionType>('individual')
  const [tournamentType, setTournamentType] = useState<SimpleTournamentType>('free')
  const [date, setDate] = useState('')
  const [location, setLocation] = useState('')
  const [desc, setDesc] = useState('')

  // Group settings
  const [groupCount, setGroupCount] = useState(4)
  const [advanceCount, setAdvanceCount] = useState(2)

  // Tournament settings
  const [tournamentSize, setTournamentSize] = useState(8)
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(true)

  // Generate date options (next 60 days)
  const dateOptions = useMemo(() => {
    const days = ['일', '월', '화', '수', '목', '금', '토']
    const options = [{ value: '', label: '-- 선택 안함 --' }]

    for (let i = 0; i < 60; i++) {
      const d = new Date()
      d.setDate(d.getDate() + i)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const dateVal = `${yyyy}-${mm}-${dd}`
      const dayName = days[d.getDay()]
      const label = `${d.getMonth() + 1}/${d.getDate()}(${dayName})`
      options.push({ value: dateVal, label })
    }

    return options
  }, [])

  const showGroupSettings = tournamentType === 'group' || tournamentType === 'group-tournament'
  const showTournamentSettings = tournamentType === 'tournament' || tournamentType === 'group-tournament'

  const handleCreate = async () => {
    if (!name.trim()) {
      alert('프로젝트명을 입력해주세요')
      return
    }

    // Map to proper tournament type
    let mappedTournamentType: TournamentType
    if (tournamentType === 'free') {
      mappedTournamentType = 'group' // Free type uses group without generating matches
    } else {
      mappedTournamentType = tournamentType
    }

    const project: Project = {
      id: Date.now(),
      name: name.trim(),
      date,
      location,
      desc,
      matches: [],
      createdAt: new Date().toISOString(),
      competitionType,
      tournamentType: mappedTournamentType,
      groups: [],
      players: [],
      teams: [],
      bracket: null,
      standings: [],
    }

    // Add group settings
    if (showGroupSettings) {
      project.groupSettings = {
        groupCount,
        advanceCount,
        setsPerMatch: 3,
      }
    }

    // Add tournament settings
    if (showTournamentSettings) {
      project.tournamentSettings = {
        size: tournamentSize,
        thirdPlaceMatch,
        setsPerMatch: 5,
      }
    }

    // Add to store
    addProject(project)

    // Sync to Firebase
    await syncProject(project)

    console.log('✅ 프로젝트 생성 완료:', project.name)
    navigate('/admin/projects')
  }

  return (
    <div className={styles.container}>
      <Header
        title="새 프로젝트 생성"
        subtitle="대회 또는 경기 프로젝트 만들기"
        gradient="linear-gradient(135deg, #fbbc04 0%, #ea4335 100%)"
        showBack
        onBack={() => navigate('/admin')}
      />

      <main>
        <Card>
          <Input
            label="프로젝트명 *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 2025 전국장애인체육대회"
          />

          <Select
            label="경기 종류 *"
            value={competitionType}
            onChange={(e) => setCompetitionType(e.target.value as CompetitionType)}
            options={[
              { value: 'individual', label: '개인전' },
              { value: 'team', label: '팀전' },
            ]}
          />

          <div className={styles.tournamentTypeSection}>
            <label>대회 유형 *</label>
            <div className={styles.tournamentTypeGrid}>
              <button
                type="button"
                className={`${styles.typeCard} ${tournamentType === 'free' ? styles.active : ''}`}
                onClick={() => setTournamentType('free')}
              >
                <div className={styles.typeTitle}>자유 경기</div>
                <div className={styles.typeDesc}>대진 없이 경기만 기록</div>
              </button>
              <button
                type="button"
                className={`${styles.typeCard} ${tournamentType === 'group' ? styles.active : ''}`}
                onClick={() => setTournamentType('group')}
              >
                <div className={styles.typeTitle}>조별 리그</div>
                <div className={styles.typeDesc}>모든 팀이 한 번씩 대결</div>
              </button>
              <button
                type="button"
                className={`${styles.typeCard} ${tournamentType === 'tournament' ? styles.active : ''}`}
                onClick={() => setTournamentType('tournament')}
              >
                <div className={styles.typeTitle}>토너먼트</div>
                <div className={styles.typeDesc}>지면 탈락하는 녹아웃</div>
              </button>
              <button
                type="button"
                className={`${styles.typeCard} ${tournamentType === 'group-tournament' ? styles.active : ''}`}
                onClick={() => setTournamentType('group-tournament')}
              >
                <div className={styles.typeTitle}>조별+토너먼트</div>
                <div className={styles.typeDesc}>조별 예선 → 결선 토너먼트</div>
              </button>
            </div>
          </div>

          {showGroupSettings && (
            <div className={styles.settingsBox}>
              <h3>조별 리그 설정</h3>
              <div className={styles.settingsGrid}>
                <Input
                  label="조 개수"
                  type="number"
                  value={groupCount}
                  onChange={(e) => setGroupCount(parseInt(e.target.value) || 2)}
                  min={1}
                  max={99}
                />
                <Input
                  label="조별 진출자 수"
                  type="number"
                  value={advanceCount}
                  onChange={(e) => setAdvanceCount(parseInt(e.target.value) || 2)}
                  min={1}
                  max={10}
                />
              </div>
              <p className={styles.hint}>
                ※ IBSA: 조별 인원이 다를 수 있으며, 승률로 순위 결정
              </p>
            </div>
          )}

          {showTournamentSettings && (
            <div className={styles.settingsBox}>
              <h3>토너먼트 설정</h3>
              <Input
                label={`참가 ${competitionType === 'team' ? '팀' : '인원'}`}
                type="number"
                value={tournamentSize}
                onChange={(e) => setTournamentSize(parseInt(e.target.value) || 8)}
                min={2}
                max={999}
              />
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={thirdPlaceMatch}
                  onChange={(e) => setThirdPlaceMatch(e.target.checked)}
                />
                3/4위 결정전 진행
              </label>
            </div>
          )}

          {competitionType === 'team' && (
            <div className={styles.infoBox}>
              <h3>IBSA 팀전 규칙</h3>
              <ul>
                <li>팀 구성: 3~6명 (혼성)</li>
                <li>라인업: 남2+여1 또는 여2+남1</li>
                <li>경기 방식: 31점 2점차, 단판</li>
                <li>서브: 3회씩 교대</li>
              </ul>
            </div>
          )}

          <Select
            label="날짜 (선택사항)"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            options={dateOptions}
          />

          <Input
            label="장소 (선택사항)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="예: 서울종합운동장"
          />

          <div className={styles.formGroup}>
            <label htmlFor="desc">설명 (선택사항)</label>
            <textarea
              id="desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="프로젝트 설명"
              rows={3}
            />
          </div>

          <div className={styles.actionRow}>
            <Button variant="danger" onClick={() => navigate('/admin')}>
              취소
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              생성
            </Button>
          </div>
        </Card>
      </main>
    </div>
  )
}
