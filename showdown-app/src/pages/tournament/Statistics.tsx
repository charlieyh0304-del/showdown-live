import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { Match } from '@/types'
import styles from './Statistics.module.css'

interface PlayerStats {
  name: string
  totalMatches: number
  wins: number
  losses: number
  winRate: number
  setWins: number
  setLosses: number
  setDiff: number
  totalPoints: number
  pointsAgainst: number
  pointDiff: number
  avgPointsPerMatch: number
  avgPointsAgainstPerMatch: number
  groupMatches: number
  bracketMatches: number
  highestScore: number
  longestWinStreak: number
}

interface MatchRecord {
  type: 'highest_score' | 'biggest_win' | 'closest_match'
  match: {
    player1: string
    player2: string
    score: string
    stage: string
  }
  value: number
}

type TabType = 'players' | 'records' | 'summary'

export function Statistics() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)

  const [activeTab, setActiveTab] = useState<TabType>('players')
  const [sortBy, setSortBy] = useState<'wins' | 'winRate' | 'points' | 'setDiff'>('wins')

  const project = projects.find((p) => p.id === parseInt(id || '0'))
  const isTeam = project?.competitionType === 'team'

  // Calculate player statistics
  const playerStats = useMemo((): PlayerStats[] => {
    if (!project?.matches) return []

    const statsMap: Record<string, PlayerStats> = {}
    const winStreaks: Record<string, { current: number; max: number }> = {}

    // Get all participants
    const participants = isTeam ? project.teams : project.players
    const allNames = (participants || []).map(p =>
      typeof p === 'string' ? p : p.name
    )

    // Initialize stats for all participants
    allNames.forEach(name => {
      statsMap[name] = {
        name,
        totalMatches: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        setWins: 0,
        setLosses: 0,
        setDiff: 0,
        totalPoints: 0,
        pointsAgainst: 0,
        pointDiff: 0,
        avgPointsPerMatch: 0,
        avgPointsAgainstPerMatch: 0,
        groupMatches: 0,
        bracketMatches: 0,
        highestScore: 0,
        longestWinStreak: 0,
      }
      winStreaks[name] = { current: 0, max: 0 }
    })

    // Process completed matches
    const completedMatches = project.matches.filter(m => m.status === 'completed')

    completedMatches.forEach(match => {
      const p1 = statsMap[match.player1Name]
      const p2 = statsMap[match.player2Name]

      if (!p1 || !p2) return

      const isGroupMatch = !!match.groupName
      const p1Sets = match.player1Sets || 0
      const p2Sets = match.player2Sets || 0
      const p1Score = match.player1Score || 0
      const p2Score = match.player2Score || 0

      // Total points from all sets
      let p1TotalPoints = p1Score
      let p2TotalPoints = p2Score

      // If we have set details, sum them up
      if (match.sets && match.sets.length > 0) {
        p1TotalPoints = match.sets.reduce((sum, s) => sum + (s.player1Score || 0), 0)
        p2TotalPoints = match.sets.reduce((sum, s) => sum + (s.player2Score || 0), 0)
      }

      // Update P1 stats
      p1.totalMatches++
      p1.setWins += p1Sets
      p1.setLosses += p2Sets
      p1.totalPoints += p1TotalPoints
      p1.pointsAgainst += p2TotalPoints
      p1.highestScore = Math.max(p1.highestScore, p1TotalPoints)
      if (isGroupMatch) p1.groupMatches++
      else p1.bracketMatches++

      // Update P2 stats
      p2.totalMatches++
      p2.setWins += p2Sets
      p2.setLosses += p1Sets
      p2.totalPoints += p2TotalPoints
      p2.pointsAgainst += p1TotalPoints
      p2.highestScore = Math.max(p2.highestScore, p2TotalPoints)
      if (isGroupMatch) p2.groupMatches++
      else p2.bracketMatches++

      // Win/loss tracking
      if (match.winner === 1) {
        p1.wins++
        p2.losses++
        winStreaks[match.player1Name].current++
        winStreaks[match.player1Name].max = Math.max(
          winStreaks[match.player1Name].max,
          winStreaks[match.player1Name].current
        )
        winStreaks[match.player2Name].current = 0
      } else if (match.winner === 2) {
        p2.wins++
        p1.losses++
        winStreaks[match.player2Name].current++
        winStreaks[match.player2Name].max = Math.max(
          winStreaks[match.player2Name].max,
          winStreaks[match.player2Name].current
        )
        winStreaks[match.player1Name].current = 0
      }
    })

    // Calculate derived stats
    Object.values(statsMap).forEach(stats => {
      stats.setDiff = stats.setWins - stats.setLosses
      stats.pointDiff = stats.totalPoints - stats.pointsAgainst
      stats.winRate = stats.totalMatches > 0
        ? Math.round((stats.wins / stats.totalMatches) * 100)
        : 0
      stats.avgPointsPerMatch = stats.totalMatches > 0
        ? Math.round(stats.totalPoints / stats.totalMatches)
        : 0
      stats.avgPointsAgainstPerMatch = stats.totalMatches > 0
        ? Math.round(stats.pointsAgainst / stats.totalMatches)
        : 0
      stats.longestWinStreak = winStreaks[stats.name]?.max || 0
    })

    // Sort
    return Object.values(statsMap)
      .filter(s => s.totalMatches > 0)
      .sort((a, b) => {
        switch (sortBy) {
          case 'winRate': return b.winRate - a.winRate
          case 'points': return b.totalPoints - a.totalPoints
          case 'setDiff': return b.setDiff - a.setDiff
          default: return b.wins - a.wins
        }
      })
  }, [project, isTeam, sortBy])

  // Calculate match records
  const matchRecords = useMemo((): MatchRecord[] => {
    if (!project?.matches) return []

    const records: MatchRecord[] = []
    const completedMatches = project.matches.filter(m => m.status === 'completed')

    if (completedMatches.length === 0) return []

    // Highest scoring match
    let highestTotal = 0
    let highestMatch: Match | null = null

    // Biggest win (set difference)
    let biggestWin = 0
    let biggestWinMatch: Match | null = null

    // Closest match
    let closestDiff = Infinity
    let closestMatch: Match | null = null

    completedMatches.forEach(match => {
      const p1Score = match.player1Score || 0
      const p2Score = match.player2Score || 0
      const p1Sets = match.player1Sets || 0
      const p2Sets = match.player2Sets || 0

      // Get total points from sets
      let totalPoints = p1Score + p2Score
      if (match.sets && match.sets.length > 0) {
        totalPoints = match.sets.reduce(
          (sum, s) => sum + (s.player1Score || 0) + (s.player2Score || 0),
          0
        )
      }

      // Highest scoring
      if (totalPoints > highestTotal) {
        highestTotal = totalPoints
        highestMatch = match
      }

      // Biggest win
      const setDiff = Math.abs(p1Sets - p2Sets)
      if (setDiff > biggestWin && (p1Sets > 0 || p2Sets > 0)) {
        biggestWin = setDiff
        biggestWinMatch = match
      }

      // Closest match (both players won at least 1 set)
      if (p1Sets > 0 && p2Sets > 0 && setDiff < closestDiff) {
        closestDiff = setDiff
        closestMatch = match
      }
    })

    if (highestMatch) {
      const m = highestMatch as Match
      let total = (m.player1Score || 0) + (m.player2Score || 0)
      if (m.sets && m.sets.length > 0) {
        total = m.sets.reduce(
          (sum: number, s) => sum + (s.player1Score || 0) + (s.player2Score || 0),
          0
        )
      }
      records.push({
        type: 'highest_score',
        match: {
          player1: m.player1Name,
          player2: m.player2Name,
          score: `${m.player1Sets}-${m.player2Sets}`,
          stage: m.groupName ? `${m.groupName}조` : (m.roundName || '본선')
        },
        value: total
      })
    }

    if (biggestWinMatch) {
      const m = biggestWinMatch as Match
      records.push({
        type: 'biggest_win',
        match: {
          player1: m.player1Name,
          player2: m.player2Name,
          score: `${m.player1Sets}-${m.player2Sets}`,
          stage: m.groupName ? `${m.groupName}조` : (m.roundName || '본선')
        },
        value: biggestWin
      })
    }

    if (closestMatch) {
      const m = closestMatch as Match
      records.push({
        type: 'closest_match',
        match: {
          player1: m.player1Name,
          player2: m.player2Name,
          score: `${m.player1Sets}-${m.player2Sets}`,
          stage: m.groupName ? `${m.groupName}조` : (m.roundName || '본선')
        },
        value: closestDiff
      })
    }

    return records
  }, [project?.matches])

  // Summary stats
  const summaryStats = useMemo(() => {
    if (!project?.matches) return null

    const completed = project.matches.filter(m => m.status === 'completed')
    const groupMatches = completed.filter(m => m.groupName)
    const bracketMatches = completed.filter(m => m.bracketRound)

    const totalSets = completed.reduce((sum, m) => {
      return sum + (m.player1Sets || 0) + (m.player2Sets || 0)
    }, 0)

    const totalPoints = completed.reduce((sum, m) => {
      if (m.sets && m.sets.length > 0) {
        return sum + m.sets.reduce((s, set) => s + (set.player1Score || 0) + (set.player2Score || 0), 0)
      }
      return sum + (m.player1Score || 0) + (m.player2Score || 0)
    }, 0)

    return {
      totalMatches: completed.length,
      groupMatches: groupMatches.length,
      bracketMatches: bracketMatches.length,
      totalSets,
      totalPoints,
      avgSetsPerMatch: completed.length > 0 ? (totalSets / completed.length).toFixed(1) : '0',
      avgPointsPerMatch: completed.length > 0 ? Math.round(totalPoints / completed.length) : 0,
    }
  }, [project?.matches])

  if (!project) {
    return (
      <div className={styles.container}>
        <Card>
          <p>프로젝트를 찾을 수 없습니다.</p>
          <Button onClick={() => navigate('/admin/projects')}>목록으로</Button>
        </Card>
      </div>
    )
  }

  const getRecordTitle = (type: string) => {
    switch (type) {
      case 'highest_score': return '최다 득점 경기'
      case 'biggest_win': return '최대 세트차 경기'
      case 'closest_match': return '가장 접전 경기'
      default: return ''
    }
  }

  return (
    <div className={styles.container}>
      <Header
        title="통계"
        subtitle={project.name}
        gradient="linear-gradient(135deg, #00bcd4 0%, #0097a7 100%)"
        showBack
        onBack={() => navigate(`/admin/project/${id}`)}
      />

      <main>
        {/* Tabs */}
        <Card className={styles.tabCard}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'players' ? styles.active : ''}`}
              onClick={() => setActiveTab('players')}
            >
              {isTeam ? '팀별' : '선수별'}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'records' ? styles.active : ''}`}
              onClick={() => setActiveTab('records')}
            >
              기록
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'summary' ? styles.active : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              요약
            </button>
          </div>
        </Card>

        {/* Player Stats Tab */}
        {activeTab === 'players' && (
          <>
            <Card>
              <div className={styles.sortOptions}>
                <span className={styles.sortLabel}>정렬:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className={styles.sortSelect}
                >
                  <option value="wins">승수</option>
                  <option value="winRate">승률</option>
                  <option value="points">총득점</option>
                  <option value="setDiff">세트득실</option>
                </select>
              </div>
            </Card>

            {playerStats.length === 0 ? (
              <Card>
                <div className={styles.emptyState}>
                  <p>완료된 경기가 없습니다.</p>
                </div>
              </Card>
            ) : (
              playerStats.map((stats, idx) => (
                <Card key={stats.name} className={styles.playerCard}>
                  <div className={styles.playerHeader}>
                    <div className={styles.playerRank}>#{idx + 1}</div>
                    <div className={styles.playerName}>{stats.name}</div>
                    <div className={styles.playerWinRate}>{stats.winRate}%</div>
                  </div>

                  <div className={styles.statsGrid}>
                    <div className={styles.statBox}>
                      <span className={styles.statValue}>{stats.wins}</span>
                      <span className={styles.statLabel}>승</span>
                    </div>
                    <div className={styles.statBox}>
                      <span className={styles.statValue}>{stats.losses}</span>
                      <span className={styles.statLabel}>패</span>
                    </div>
                    <div className={styles.statBox}>
                      <span className={`${styles.statValue} ${stats.setDiff > 0 ? styles.positive : stats.setDiff < 0 ? styles.negative : ''}`}>
                        {stats.setDiff > 0 ? '+' : ''}{stats.setDiff}
                      </span>
                      <span className={styles.statLabel}>세트득실</span>
                    </div>
                    <div className={styles.statBox}>
                      <span className={styles.statValue}>{stats.totalPoints}</span>
                      <span className={styles.statLabel}>총득점</span>
                    </div>
                  </div>

                  <div className={styles.detailStats}>
                    <div className={styles.detailItem}>
                      <span>경기수</span>
                      <span>{stats.totalMatches} (조별 {stats.groupMatches} / 본선 {stats.bracketMatches})</span>
                    </div>
                    <div className={styles.detailItem}>
                      <span>세트</span>
                      <span>{stats.setWins}승 {stats.setLosses}패</span>
                    </div>
                    <div className={styles.detailItem}>
                      <span>평균 득점</span>
                      <span>{stats.avgPointsPerMatch}점/경기</span>
                    </div>
                    {stats.longestWinStreak > 1 && (
                      <div className={styles.detailItem}>
                        <span>최다 연승</span>
                        <span>{stats.longestWinStreak}연승</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))
            )}
          </>
        )}

        {/* Records Tab */}
        {activeTab === 'records' && (
          <>
            {matchRecords.length === 0 ? (
              <Card>
                <div className={styles.emptyState}>
                  <p>기록할 경기가 없습니다.</p>
                </div>
              </Card>
            ) : (
              matchRecords.map((record, idx) => (
                <Card key={idx} className={styles.recordCard}>
                  <div className={styles.recordTitle}>{getRecordTitle(record.type)}</div>
                  <div className={styles.recordMatch}>
                    <span className={styles.recordPlayers}>
                      {record.match.player1} vs {record.match.player2}
                    </span>
                    <span className={styles.recordScore}>{record.match.score}</span>
                  </div>
                  <div className={styles.recordMeta}>
                    <span className={styles.recordStage}>{record.match.stage}</span>
                    <span className={styles.recordValue}>
                      {record.type === 'highest_score' && `총 ${record.value}점`}
                      {record.type === 'biggest_win' && `${record.value}세트 차`}
                      {record.type === 'closest_match' && `${record.value}세트 차`}
                    </span>
                  </div>
                </Card>
              ))
            )}

            {/* Top performers */}
            {playerStats.length > 0 && (
              <Card>
                <h3 className={styles.sectionTitle}>개인 기록</h3>
                <div className={styles.topPerformers}>
                  <div className={styles.topItem}>
                    <span className={styles.topLabel}>최다승</span>
                    <span className={styles.topValue}>
                      {playerStats[0]?.name} ({playerStats[0]?.wins}승)
                    </span>
                  </div>
                  <div className={styles.topItem}>
                    <span className={styles.topLabel}>최고 승률</span>
                    <span className={styles.topValue}>
                      {[...playerStats].sort((a, b) => b.winRate - a.winRate)[0]?.name}
                      ({[...playerStats].sort((a, b) => b.winRate - a.winRate)[0]?.winRate}%)
                    </span>
                  </div>
                  <div className={styles.topItem}>
                    <span className={styles.topLabel}>최다 득점</span>
                    <span className={styles.topValue}>
                      {[...playerStats].sort((a, b) => b.totalPoints - a.totalPoints)[0]?.name}
                      ({[...playerStats].sort((a, b) => b.totalPoints - a.totalPoints)[0]?.totalPoints}점)
                    </span>
                  </div>
                  {playerStats.some(s => s.longestWinStreak > 1) && (
                    <div className={styles.topItem}>
                      <span className={styles.topLabel}>최다 연승</span>
                      <span className={styles.topValue}>
                        {[...playerStats].sort((a, b) => b.longestWinStreak - a.longestWinStreak)[0]?.name}
                        ({[...playerStats].sort((a, b) => b.longestWinStreak - a.longestWinStreak)[0]?.longestWinStreak}연승)
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}

        {/* Summary Tab */}
        {activeTab === 'summary' && summaryStats && (
          <>
            <Card>
              <h3 className={styles.sectionTitle}>대회 요약</h3>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{summaryStats.totalMatches}</span>
                  <span className={styles.summaryLabel}>총 경기</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{summaryStats.groupMatches}</span>
                  <span className={styles.summaryLabel}>조별 리그</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{summaryStats.bracketMatches}</span>
                  <span className={styles.summaryLabel}>본선</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{summaryStats.totalSets}</span>
                  <span className={styles.summaryLabel}>총 세트</span>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className={styles.sectionTitle}>평균 통계</h3>
              <div className={styles.avgStats}>
                <div className={styles.avgItem}>
                  <span className={styles.avgLabel}>경기당 평균 세트</span>
                  <span className={styles.avgValue}>{summaryStats.avgSetsPerMatch}세트</span>
                </div>
                <div className={styles.avgItem}>
                  <span className={styles.avgLabel}>경기당 평균 득점</span>
                  <span className={styles.avgValue}>{summaryStats.avgPointsPerMatch}점</span>
                </div>
                <div className={styles.avgItem}>
                  <span className={styles.avgLabel}>총 득점</span>
                  <span className={styles.avgValue}>{summaryStats.totalPoints}점</span>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className={styles.sectionTitle}>참가자</h3>
              <div className={styles.participantInfo}>
                <div className={styles.participantItem}>
                  <span>총 {isTeam ? '팀' : '선수'} 수</span>
                  <span>{playerStats.length}명</span>
                </div>
                <div className={styles.participantItem}>
                  <span>경기 참여율</span>
                  <span>
                    {playerStats.filter(s => s.totalMatches > 0).length} / {playerStats.length}
                  </span>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* Back Button */}
        <Card>
          <Button onClick={() => navigate(`/admin/project/${id}`)}>
            ← 대회로 돌아가기
          </Button>
        </Card>
      </main>
    </div>
  )
}
