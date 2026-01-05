import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { Match } from '@/types'
import styles from './ViewerProjectDetail.module.css'

type TabType = 'live' | 'standings' | 'bracket' | 'matches'

export function ViewerProjectDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)

  const [activeTab, setActiveTab] = useState<TabType>('live')

  const project = projects.find((p) => p.id === parseInt(id || '0'))
  const isTeam = project?.competitionType === 'team'

  // Live/Active matches
  const liveMatches = useMemo(() => {
    if (!project?.matches) return []
    return project.matches.filter(m => m.status === 'active')
  }, [project?.matches])

  // Recent completed matches
  const recentMatches = useMemo(() => {
    if (!project?.matches) return []
    return project.matches
      .filter(m => m.status === 'completed')
      .sort((a, b) => {
        const dateA = a.endTime ? new Date(a.endTime).getTime() : 0
        const dateB = b.endTime ? new Date(b.endTime).getTime() : 0
        return dateB - dateA
      })
      .slice(0, 10)
  }, [project?.matches])

  // Group standings
  const groupStandings = useMemo(() => {
    if (!project?.groups) return []

    return project.groups.map((group) => {
      const members = isTeam ? group.members : group.players
      const memberNames = members?.map(m => typeof m === 'string' ? m : m.name) || []

      const standingsMap: Record<string, { wins: number; losses: number; setDiff: number; points: number }> = {}
      memberNames.forEach(name => {
        standingsMap[name] = { wins: 0, losses: 0, setDiff: 0, points: 0 }
      })

      const groupMatches = project.matches?.filter(
        m => m.groupName === group.name && m.status === 'completed'
      ) || []

      groupMatches.forEach((match) => {
        const p1 = standingsMap[match.player1Name]
        const p2 = standingsMap[match.player2Name]
        if (!p1 || !p2) return

        p1.setDiff += (match.player1Sets || 0) - (match.player2Sets || 0)
        p2.setDiff += (match.player2Sets || 0) - (match.player1Sets || 0)

        if (match.winner === 1) {
          p1.wins++
          p1.points += 2
          p2.losses++
        } else if (match.winner === 2) {
          p2.wins++
          p2.points += 2
          p1.losses++
        }
      })

      const sorted = Object.entries(standingsMap)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.points - a.points || b.setDiff - a.setDiff)

      return {
        name: group.name,
        standings: sorted,
        totalMatches: group.matches?.length || 0,
        completedMatches: groupMatches.length,
      }
    })
  }, [project, isTeam])

  // Bracket matches
  const bracketMatches = useMemo(() => {
    if (!project?.matches) return []
    return project.matches.filter(m => m.bracketRound && m.bracketRound > 0)
  }, [project?.matches])

  // Group bracket by round
  const bracketByRound = useMemo(() => {
    const grouped: Record<number, Match[]> = {}
    bracketMatches.forEach(m => {
      const round = m.bracketRound || 1
      if (!grouped[round]) grouped[round] = []
      grouped[round].push(m)
    })
    return grouped
  }, [bracketMatches])

  if (!project) {
    return (
      <div className={styles.container}>
        <Card>
          <p>대회를 찾을 수 없습니다.</p>
          <Button onClick={() => navigate('/viewer/projects')}>목록으로</Button>
        </Card>
      </div>
    )
  }

  const advanceCount = project.groupSettings?.advanceCount || 2

  return (
    <div className={styles.container}>
      <Header
        title={project.name}
        subtitle={`${project.date} · ${project.location || '장소 미정'}`}
        gradient="linear-gradient(135deg, #4285f4 0%, #34a853 100%)"
        showBack
        onBack={() => navigate('/viewer/projects')}
      />

      <main>
        {/* Tabs */}
        <Card className={styles.tabCard}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'live' ? styles.active : ''}`}
              onClick={() => setActiveTab('live')}
            >
              실시간
              {liveMatches.length > 0 && (
                <span className={styles.badge}>{liveMatches.length}</span>
              )}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'standings' ? styles.active : ''}`}
              onClick={() => setActiveTab('standings')}
            >
              순위
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'bracket' ? styles.active : ''}`}
              onClick={() => setActiveTab('bracket')}
            >
              대진표
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'matches' ? styles.active : ''}`}
              onClick={() => setActiveTab('matches')}
            >
              경기
            </button>
          </div>
        </Card>

        {/* Live Tab */}
        {activeTab === 'live' && (
          <>
            {liveMatches.length > 0 ? (
              <>
                <h3 className={styles.sectionTitle}>진행 중인 경기</h3>
                {liveMatches.map((match) => (
                  <Card key={match.id} className={styles.liveCard}>
                    <div className={styles.liveHeader}>
                      <span className={styles.liveBadge}>LIVE</span>
                      <span className={styles.liveStage}>
                        {match.groupName ? `${match.groupName}조` : match.roundName || '본선'}
                      </span>
                    </div>
                    <div className={styles.liveScore}>
                      <div className={styles.livePlayer}>
                        <span className={styles.playerName}>{match.player1Name}</span>
                        <span className={styles.setScore}>{match.player1Sets || 0}</span>
                      </div>
                      <div className={styles.currentScore}>
                        {match.sets && match.sets[match.currentSet - 1] ? (
                          <>
                            <span>{match.sets[match.currentSet - 1].player1Score}</span>
                            <span className={styles.separator}>:</span>
                            <span>{match.sets[match.currentSet - 1].player2Score}</span>
                          </>
                        ) : (
                          <>
                            <span>{match.player1Score || 0}</span>
                            <span className={styles.separator}>:</span>
                            <span>{match.player2Score || 0}</span>
                          </>
                        )}
                      </div>
                      <div className={styles.livePlayer}>
                        <span className={styles.setScore}>{match.player2Sets || 0}</span>
                        <span className={styles.playerName}>{match.player2Name}</span>
                      </div>
                    </div>
                    <div className={styles.setInfo}>
                      세트 {match.currentSet} / {match.setsToWin * 2 - 1}
                    </div>
                  </Card>
                ))}
              </>
            ) : (
              <Card>
                <div className={styles.emptyState}>
                  <p>현재 진행 중인 경기가 없습니다.</p>
                </div>
              </Card>
            )}

            {recentMatches.length > 0 && (
              <>
                <h3 className={styles.sectionTitle}>최근 완료된 경기</h3>
                {recentMatches.slice(0, 5).map((match) => (
                  <Card key={match.id} className={styles.matchCard}>
                    <div className={styles.matchStage}>
                      {match.groupName ? `${match.groupName}조` : match.roundName || '본선'}
                    </div>
                    <div className={styles.matchResult}>
                      <span className={`${styles.matchPlayer} ${match.winner === 1 ? styles.winner : ''}`}>
                        {match.player1Name}
                      </span>
                      <span className={styles.matchScore}>
                        {match.player1Sets} - {match.player2Sets}
                      </span>
                      <span className={`${styles.matchPlayer} ${match.winner === 2 ? styles.winner : ''}`}>
                        {match.player2Name}
                      </span>
                    </div>
                  </Card>
                ))}
              </>
            )}
          </>
        )}

        {/* Standings Tab */}
        {activeTab === 'standings' && (
          <>
            {groupStandings.length === 0 ? (
              <Card>
                <div className={styles.emptyState}>
                  <p>조별 리그 정보가 없습니다.</p>
                </div>
              </Card>
            ) : (
              groupStandings.map((group) => (
                <Card key={group.name} className={styles.groupCard}>
                  <div className={styles.groupHeader}>
                    <h3 className={styles.groupName}>{group.name}조</h3>
                    <span className={styles.groupProgress}>
                      {group.completedMatches}/{group.totalMatches}경기
                    </span>
                  </div>
                  <div className={styles.standingsTable}>
                    <div className={styles.tableHeader}>
                      <span className={styles.rankCol}>#</span>
                      <span className={styles.nameCol}>이름</span>
                      <span className={styles.statCol}>승</span>
                      <span className={styles.statCol}>패</span>
                      <span className={styles.statCol}>득실</span>
                    </div>
                    {group.standings.map((player, idx) => (
                      <div
                        key={player.name}
                        className={`${styles.tableRow} ${idx < advanceCount ? styles.advancing : ''}`}
                      >
                        <span className={styles.rankCol}>
                          <span className={`${styles.rank} ${idx < advanceCount ? styles.top : ''}`}>
                            {idx + 1}
                          </span>
                        </span>
                        <span className={styles.nameCol}>{player.name}</span>
                        <span className={`${styles.statCol} ${styles.wins}`}>{player.wins}</span>
                        <span className={`${styles.statCol} ${styles.losses}`}>{player.losses}</span>
                        <span className={`${styles.statCol} ${player.setDiff > 0 ? styles.positive : player.setDiff < 0 ? styles.negative : ''}`}>
                          {player.setDiff > 0 ? '+' : ''}{player.setDiff}
                        </span>
                      </div>
                    ))}
                  </div>
                  {advanceCount > 0 && (
                    <p className={styles.advanceNote}>상위 {advanceCount}명 본선 진출</p>
                  )}
                </Card>
              ))
            )}
          </>
        )}

        {/* Bracket Tab */}
        {activeTab === 'bracket' && (
          <>
            {bracketMatches.length === 0 ? (
              <Card>
                <div className={styles.emptyState}>
                  <p>본선 대진표가 없습니다.</p>
                </div>
              </Card>
            ) : (
              <Card className={styles.bracketCard}>
                <div className={styles.bracketWrapper}>
                  <div className={styles.bracket}>
                    {Object.entries(bracketByRound)
                      .sort(([a], [b]) => parseInt(a) - parseInt(b))
                      .map(([round, matches]) => (
                        <div key={round} className={styles.round}>
                          <div className={styles.roundHeader}>
                            {matches[0]?.roundName || `${round}라운드`}
                          </div>
                          <div className={styles.roundMatches}>
                            {matches
                              .filter(m => !m.isThirdPlace)
                              .sort((a, b) => (a.bracketMatchNum || 0) - (b.bracketMatchNum || 0))
                              .map((match) => (
                                <div
                                  key={match.id}
                                  className={`${styles.bracketMatch} ${styles[match.status]}`}
                                >
                                  <div className={`${styles.bracketPlayer} ${match.winner === 1 ? styles.winner : ''}`}>
                                    <span>{match.player1Name || 'TBD'}</span>
                                    {match.status === 'completed' && <span>{match.player1Sets}</span>}
                                  </div>
                                  <div className={`${styles.bracketPlayer} ${match.winner === 2 ? styles.winner : ''}`}>
                                    <span>{match.player2Name || 'TBD'}</span>
                                    {match.status === 'completed' && <span>{match.player2Sets}</span>}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* 3rd place match */}
                {bracketMatches.some(m => m.isThirdPlace) && (
                  <div className={styles.thirdPlace}>
                    <h4>3/4위전</h4>
                    {bracketMatches
                      .filter(m => m.isThirdPlace)
                      .map((match) => (
                        <div key={match.id} className={`${styles.bracketMatch} ${styles[match.status]}`}>
                          <div className={`${styles.bracketPlayer} ${match.winner === 1 ? styles.winner : ''}`}>
                            <span>{match.player1Name || 'TBD'}</span>
                            {match.status === 'completed' && <span>{match.player1Sets}</span>}
                          </div>
                          <div className={`${styles.bracketPlayer} ${match.winner === 2 ? styles.winner : ''}`}>
                            <span>{match.player2Name || 'TBD'}</span>
                            {match.status === 'completed' && <span>{match.player2Sets}</span>}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </Card>
            )}
          </>
        )}

        {/* Matches Tab */}
        {activeTab === 'matches' && (
          <>
            {(project.matches?.length || 0) === 0 ? (
              <Card>
                <div className={styles.emptyState}>
                  <p>등록된 경기가 없습니다.</p>
                </div>
              </Card>
            ) : (
              <>
                {/* All matches by status */}
                {['active', 'ready', 'completed', 'pending'].map((status) => {
                  const filtered = project.matches?.filter(m => m.status === status) || []
                  if (filtered.length === 0) return null

                  const statusLabel = {
                    active: '진행 중',
                    ready: '대기 중',
                    completed: '완료',
                    pending: '예정'
                  }[status]

                  return (
                    <div key={status}>
                      <h3 className={styles.sectionTitle}>
                        {statusLabel} ({filtered.length})
                      </h3>
                      {filtered.slice(0, status === 'completed' ? 20 : 10).map((match) => (
                        <Card key={match.id} className={styles.matchCard}>
                          <div className={styles.matchStage}>
                            {match.groupName ? `${match.groupName}조` : match.roundName || '본선'}
                          </div>
                          <div className={styles.matchResult}>
                            <span className={`${styles.matchPlayer} ${match.winner === 1 ? styles.winner : ''}`}>
                              {match.player1Name || 'TBD'}
                            </span>
                            <span className={styles.matchScore}>
                              {match.status === 'completed'
                                ? `${match.player1Sets} - ${match.player2Sets}`
                                : match.status === 'active'
                                  ? `${match.player1Score || 0} : ${match.player2Score || 0}`
                                  : 'vs'}
                            </span>
                            <span className={`${styles.matchPlayer} ${match.winner === 2 ? styles.winner : ''}`}>
                              {match.player2Name || 'TBD'}
                            </span>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
