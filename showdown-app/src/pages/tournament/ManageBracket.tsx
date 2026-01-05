import { useState, useMemo, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button, Select, Modal } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { Match } from '@/types'
import styles from './ManageBracket.module.css'

interface BracketMatch {
  id: number
  bracketRound: number
  bracketMatchNum: number
  player1: string | null
  player2: string | null
  player1Sets?: number
  player2Sets?: number
  winner?: 1 | 2 | null
  status: 'pending' | 'ready' | 'active' | 'completed' | 'waiting'
  nextMatchId?: number
  nextSlot?: 1 | 2
  roundName?: string
  isThirdPlace?: boolean
}

export function ManageBracket() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)
  const updateProject = useProjectStore((state) => state.updateProject)

  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [bracketSize, setBracketSize] = useState(8)
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(true)

  const project = projects.find((p) => p.id === parseInt(id || '0'))
  const isTeam = project?.competitionType === 'team'

  // Get qualifiers from group stage
  const qualifiers = useMemo(() => {
    if (!project?.groups || project.groups.length === 0) return []

    const advanceCount = project.groupSettings?.advanceCount || 2
    const allQualifiers: { name: string; group: string; rank: number }[] = []

    project.groups.forEach((group) => {
      const members = isTeam ? group.members : group.players
      const memberNames = members?.map(m => typeof m === 'string' ? m : m.name) || []

      // Calculate standings for this group
      const standingsMap: Record<string, { wins: number; setDiff: number; goalDiff: number; goalsFor: number }> = {}
      memberNames.forEach(name => {
        standingsMap[name] = { wins: 0, setDiff: 0, goalDiff: 0, goalsFor: 0 }
      })

      const groupMatches = project.matches?.filter(
        m => m.groupName === group.name && m.status === 'completed'
      ) || []

      groupMatches.forEach((match) => {
        const p1 = standingsMap[match.player1Name]
        const p2 = standingsMap[match.player2Name]
        if (!p1 || !p2) return

        const p1Sets = match.player1Sets || 0
        const p2Sets = match.player2Sets || 0
        const p1Score = match.player1Score || 0
        const p2Score = match.player2Score || 0

        p1.setDiff += p1Sets - p2Sets
        p2.setDiff += p2Sets - p1Sets
        p1.goalDiff += p1Score - p2Score
        p2.goalDiff += p2Score - p1Score
        p1.goalsFor += p1Score
        p2.goalsFor += p2Score

        if (match.winner === 1) p1.wins += 1
        else if (match.winner === 2) p2.wins += 1
      })

      // Sort and get top N
      const sorted = Object.entries(standingsMap)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins
          if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff
          if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
          return b.goalsFor - a.goalsFor
        })

      sorted.slice(0, advanceCount).forEach((player, idx) => {
        allQualifiers.push({
          name: player.name,
          group: group.name,
          rank: idx + 1
        })
      })
    })

    return allQualifiers
  }, [project, isTeam])

  // Parse existing bracket matches from project
  const bracketMatches = useMemo((): BracketMatch[] => {
    if (!project?.matches) return []

    return project.matches
      .filter(m => m.bracketRound !== undefined && m.bracketRound > 0)
      .map(m => ({
        id: m.id,
        bracketRound: m.bracketRound || 1,
        bracketMatchNum: m.bracketMatchNum || 1,
        player1: m.player1Name || null,
        player2: m.player2Name || null,
        player1Sets: m.player1Sets,
        player2Sets: m.player2Sets,
        winner: m.winner as 1 | 2 | null,
        status: m.status,
        nextMatchId: m.nextMatchId,
        nextSlot: m.nextSlot as 1 | 2 | undefined,
        roundName: m.roundName,
        isThirdPlace: m.isThirdPlace
      }))
  }, [project?.matches])

  // Get bracket info
  const bracketInfo = useMemo(() => {
    if (bracketMatches.length === 0) return null

    const rounds = [...new Set(bracketMatches.map(m => m.bracketRound))].sort((a, b) => a - b)
    const totalRounds = rounds.length
    const firstRoundMatches = bracketMatches.filter(m => m.bracketRound === 1).length
    const size = firstRoundMatches * 2

    return { rounds, totalRounds, size }
  }, [bracketMatches])

  // Generate bracket with IBSA cross-seeding
  const handleGenerateBracket = useCallback(() => {
    if (!id || !project) return

    // Determine actual participants
    let participants: string[] = []

    if (qualifiers.length >= 2) {
      // Use group qualifiers with IBSA seeding
      const groupCount = project.groups?.length || 0

      if (groupCount >= 2) {
        // IBSA Cross-seeding: 1A vs 2B, 1B vs 2A, etc.
        const byRank: Record<number, { name: string; group: string }[]> = {}
        qualifiers.forEach(q => {
          if (!byRank[q.rank]) byRank[q.rank] = []
          byRank[q.rank].push({ name: q.name, group: q.group })
        })

        // Interleave for cross-seeding
        const rank1 = byRank[1] || []
        const rank2 = byRank[2] || []

        // Pair 1A-2B, 1B-2A pattern
        for (let i = 0; i < Math.max(rank1.length, rank2.length); i++) {
          if (rank1[i]) participants.push(rank1[i].name)
          const crossIdx = (rank2.length - 1 - i + rank2.length) % rank2.length
          if (rank2[crossIdx] && !participants.includes(rank2[crossIdx].name)) {
            participants.push(rank2[crossIdx].name)
          }
        }
        // Add remaining rank2 players
        rank2.forEach(p => {
          if (!participants.includes(p.name)) participants.push(p.name)
        })
      } else {
        participants = qualifiers.map(q => q.name)
      }
    } else {
      // No groups, use all players/teams
      const allParticipants = isTeam ? project.teams : project.players
      participants = (allParticipants || []).map(p =>
        typeof p === 'string' ? p : p.name
      )
    }

    // Pad to bracket size
    while (participants.length < bracketSize) {
      participants.push('')  // BYE
    }
    participants = participants.slice(0, bracketSize)

    // Calculate rounds needed
    const totalRounds = Math.log2(bracketSize)
    const newMatches: Match[] = []
    let matchId = Date.now()

    // Generate bracket matches
    for (let round = 1; round <= totalRounds; round++) {
      const matchesInRound = bracketSize / Math.pow(2, round)

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        const match: Match = {
          id: matchId++,
          refereePin: '',
          player1Name: '',
          player2Name: '',
          type: isTeam ? 'team' : 'individual',
          sets: [],
          setsToWin: project.tournamentSettings?.setsPerMatch || 3,
          winScore: 11,
          currentSet: 1,
          currentServer: 1,
          serveCount: 0,
          serveSelected: false,
          status: 'pending',
          timeouts: { player1: 1, player2: 1 },
          sideChangeUsed: false,
          warmupUsed: false,
          history: [],
          createdAt: new Date().toISOString(),
          bracketRound: round,
          bracketMatchNum: matchNum,
          roundName: getRoundName(round, totalRounds),
        }

        // Set players for first round
        if (round === 1) {
          const idx = (matchNum - 1) * 2
          match.player1Name = participants[idx] || ''
          match.player2Name = participants[idx + 1] || ''

          // Handle BYE
          if (match.player1Name && !match.player2Name) {
            match.status = 'completed'
            match.winner = 1
            match.player1Sets = project.tournamentSettings?.setsPerMatch || 3
            match.player2Sets = 0
          } else if (!match.player1Name && match.player2Name) {
            match.status = 'completed'
            match.winner = 2
            match.player1Sets = 0
            match.player2Sets = project.tournamentSettings?.setsPerMatch || 3
          } else if (match.player1Name && match.player2Name) {
            match.status = 'ready'
          }
        }

        // Link to next match
        if (round < totalRounds) {
          match.nextMatchId = matchId + Math.floor(matchesInRound / 2) + Math.floor((matchNum - 1) / 2)
          match.nextSlot = ((matchNum - 1) % 2 === 0) ? 1 : 2
        }

        newMatches.push(match)
      }
    }

    // Add 3rd place match
    if (thirdPlaceMatch && totalRounds >= 2) {
      const thirdMatch: Match = {
        id: matchId++,
        refereePin: '',
        player1Name: '',
        player2Name: '',
        type: isTeam ? 'team' : 'individual',
        sets: [],
        setsToWin: project.tournamentSettings?.setsPerMatch || 3,
        winScore: 11,
        currentSet: 1,
        currentServer: 1,
        serveCount: 0,
        serveSelected: false,
        status: 'pending',
        timeouts: { player1: 1, player2: 1 },
        sideChangeUsed: false,
        warmupUsed: false,
        history: [],
        createdAt: new Date().toISOString(),
        bracketRound: totalRounds,
        bracketMatchNum: 0,  // Special marker for 3rd place
        roundName: '3/4위전',
        isThirdPlace: true,
      }
      newMatches.push(thirdMatch)
    }

    // Advance BYE winners
    advanceBYEWinners(newMatches)

    // Combine with existing group matches
    const groupMatches = project.matches?.filter(m => m.groupName) || []
    const allMatches = [...groupMatches, ...newMatches]

    updateProject(parseInt(id), {
      matches: allMatches,
      tournamentSettings: {
        ...project.tournamentSettings,
        size: bracketSize,
        thirdPlaceMatch,
        setsPerMatch: project.tournamentSettings?.setsPerMatch || 3,
      }
    })
    setShowGenerateModal(false)
  }, [id, project, qualifiers, bracketSize, thirdPlaceMatch, isTeam, updateProject])

  // Helper to advance BYE winners
  const advanceBYEWinners = (matches: Match[]) => {
    const completedFirst = matches.filter(m => m.bracketRound === 1 && m.status === 'completed')
    completedFirst.forEach(match => {
      if (match.nextMatchId && match.winner) {
        const nextMatch = matches.find(m => m.id === match.nextMatchId)
        if (nextMatch) {
          const winner = match.winner === 1 ? match.player1Name : match.player2Name
          if (match.nextSlot === 1) {
            nextMatch.player1Name = winner
          } else {
            nextMatch.player2Name = winner
          }
          if (nextMatch.player1Name && nextMatch.player2Name) {
            nextMatch.status = 'ready'
          }
        }
      }
    })
  }

  // Get round name
  const getRoundName = (round: number, total: number): string => {
    const remaining = total - round
    if (remaining === 0) return '결승'
    if (remaining === 1) return '준결승'
    if (remaining === 2) return '8강'
    if (remaining === 3) return '16강'
    if (remaining === 4) return '32강'
    return `${Math.pow(2, remaining + 1)}강`
  }

  // Clear bracket
  const handleClearBracket = () => {
    if (!window.confirm('본선 대진표를 삭제하시겠습니까?')) return
    if (!id || !project) return

    const groupMatches = project.matches?.filter(m => m.groupName) || []
    updateProject(parseInt(id), { matches: groupMatches })
  }

  // Navigate to match
  const handleMatchClick = (match: BracketMatch) => {
    if (match.status === 'ready' || match.status === 'active') {
      navigate(`/referee/match/${match.id}`)
    }
  }

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

  const groupedByRound = bracketMatches.reduce((acc, match) => {
    if (!acc[match.bracketRound]) acc[match.bracketRound] = []
    acc[match.bracketRound].push(match)
    return acc
  }, {} as Record<number, BracketMatch[]>)

  return (
    <div className={styles.container}>
      <Header
        title="본선 대진표"
        subtitle={project.name}
        gradient="linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)"
        showBack
        onBack={() => navigate(`/admin/project/${id}`)}
      />

      <main>
        {/* Actions */}
        <Card>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setShowGenerateModal(true)}>
              대진표 생성
            </Button>
            {bracketMatches.length > 0 && (
              <Button variant="danger" onClick={handleClearBracket}>
                대진표 초기화
              </Button>
            )}
          </div>
          {qualifiers.length > 0 && (
            <p className={styles.info}>
              조별 리그 진출자: {qualifiers.length}명
            </p>
          )}
        </Card>

        {/* Qualifiers Preview */}
        {qualifiers.length > 0 && bracketMatches.length === 0 && (
          <Card>
            <h3 className={styles.sectionTitle}>조별 리그 진출자</h3>
            <div className={styles.qualifierList}>
              {qualifiers.map((q, idx) => (
                <div key={idx} className={styles.qualifierItem}>
                  <span className={styles.qualifierRank}>{q.group}{q.rank}위</span>
                  <span className={styles.qualifierName}>{q.name}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Bracket View */}
        {bracketMatches.length > 0 ? (
          <Card className={styles.bracketCard}>
            <h3 className={styles.sectionTitle}>
              대진표 ({bracketInfo?.size}강)
            </h3>
            <div className={styles.bracketWrapper}>
              <div className={styles.bracket}>
                {Object.entries(groupedByRound)
                  .sort(([a], [b]) => parseInt(a) - parseInt(b))
                  .map(([round, matches]) => (
                    <div key={round} className={styles.round}>
                      <div className={styles.roundHeader}>
                        {matches[0]?.roundName || `${Math.pow(2, bracketInfo!.totalRounds - parseInt(round) + 1)}강`}
                      </div>
                      <div className={styles.roundMatches}>
                        {matches
                          .filter(m => !m.isThirdPlace)
                          .sort((a, b) => a.bracketMatchNum - b.bracketMatchNum)
                          .map((match) => (
                            <div
                              key={match.id}
                              className={`${styles.match} ${styles[match.status]}`}
                              onClick={() => handleMatchClick(match)}
                            >
                              <div className={`${styles.player} ${match.winner === 1 ? styles.winner : ''}`}>
                                <span className={styles.playerName}>
                                  {match.player1 || 'TBD'}
                                </span>
                                {match.status === 'completed' && (
                                  <span className={styles.score}>{match.player1Sets}</span>
                                )}
                              </div>
                              <div className={`${styles.player} ${match.winner === 2 ? styles.winner : ''}`}>
                                <span className={styles.playerName}>
                                  {match.player2 || 'TBD'}
                                </span>
                                {match.status === 'completed' && (
                                  <span className={styles.score}>{match.player2Sets}</span>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* 3rd Place Match */}
            {bracketMatches.some(m => m.isThirdPlace) && (
              <div className={styles.thirdPlace}>
                <h4 className={styles.thirdPlaceTitle}>3/4위전</h4>
                {bracketMatches
                  .filter(m => m.isThirdPlace)
                  .map((match) => (
                    <div
                      key={match.id}
                      className={`${styles.match} ${styles[match.status]}`}
                      onClick={() => handleMatchClick(match)}
                    >
                      <div className={`${styles.player} ${match.winner === 1 ? styles.winner : ''}`}>
                        <span className={styles.playerName}>
                          {match.player1 || 'TBD'}
                        </span>
                        {match.status === 'completed' && (
                          <span className={styles.score}>{match.player1Sets}</span>
                        )}
                      </div>
                      <div className={`${styles.player} ${match.winner === 2 ? styles.winner : ''}`}>
                        <span className={styles.playerName}>
                          {match.player2 || 'TBD'}
                        </span>
                        {match.status === 'completed' && (
                          <span className={styles.score}>{match.player2Sets}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <div className={styles.emptyState}>
              <p>생성된 대진표가 없습니다.</p>
              <p>"대진표 생성" 버튼을 눌러주세요.</p>
            </div>
          </Card>
        )}

        {/* Back Button */}
        <Card>
          <Button onClick={() => navigate(`/admin/project/${id}`)}>
            ← 대회로 돌아가기
          </Button>
        </Card>
      </main>

      {/* Generate Modal */}
      <Modal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="대진표 생성"
      >
        <div className={styles.modalContent}>
          {qualifiers.length > 0 && (
            <p className={styles.modalInfo}>
              조별 리그 진출자 {qualifiers.length}명으로 본선 대진표를 생성합니다.
            </p>
          )}

          <Select
            label="토너먼트 크기"
            value={bracketSize.toString()}
            onChange={(e) => setBracketSize(parseInt(e.target.value))}
            options={[
              { value: '4', label: '4강 (4명)' },
              { value: '8', label: '8강 (8명)' },
              { value: '16', label: '16강 (16명)' },
              { value: '32', label: '32강 (32명)' },
            ]}
          />

          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={thirdPlaceMatch}
              onChange={(e) => setThirdPlaceMatch(e.target.checked)}
            />
            3/4위전 포함
          </label>

          <p className={styles.modalNote}>
            IBSA 크로스 시딩이 적용됩니다. (1A vs 2B 방식)
          </p>

          <div className={styles.modalActions}>
            <Button onClick={() => setShowGenerateModal(false)}>취소</Button>
            <Button variant="primary" onClick={handleGenerateBracket}>생성</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
