import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { PlayerStanding } from '@/types'
import styles from './Standings.module.css'

interface CalculatedStanding extends PlayerStanding {
  rank: number
  points: number
}

export function Standings() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)

  const project = projects.find((p) => p.id === parseInt(id || '0'))
  const isTeam = project?.competitionType === 'team'

  // Calculate standings from matches
  const groupStandings = useMemo(() => {
    if (!project?.groups) return []

    return project.groups.map((group) => {
      const members = isTeam ? group.members : group.players
      const memberNames = members?.map(m => typeof m === 'string' ? m : m.name) || []

      // Initialize standings
      const standingsMap: Record<string, CalculatedStanding> = {}
      memberNames.forEach((name) => {
        standingsMap[name] = {
          name,
          rank: 0,
          wins: 0,
          losses: 0,
          setWins: 0,
          setLosses: 0,
          setDiff: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDiff: 0,
          points: 0,
        }
      })

      // Calculate from completed matches
      const groupMatches = project.matches?.filter(
        (m) => m.groupName === group.name && m.status === 'completed'
      ) || []

      groupMatches.forEach((match) => {
        const p1 = standingsMap[match.player1Name]
        const p2 = standingsMap[match.player2Name]

        if (!p1 || !p2) return

        const p1Sets = match.player1Sets || 0
        const p2Sets = match.player2Sets || 0
        const p1Score = match.player1Score || 0
        const p2Score = match.player2Score || 0

        // Update set stats
        p1.setWins += p1Sets
        p1.setLosses += p2Sets
        p2.setWins += p2Sets
        p2.setLosses += p1Sets

        // Update point stats
        p1.goalsFor += p1Score
        p1.goalsAgainst += p2Score
        p2.goalsFor += p2Score
        p2.goalsAgainst += p1Score

        // Determine winner
        if (match.winner === 1) {
          p1.wins += 1
          p1.points += 2
          p2.losses += 1
        } else if (match.winner === 2) {
          p2.wins += 1
          p2.points += 2
          p1.losses += 1
        }
      })

      // Calculate diffs
      Object.values(standingsMap).forEach((s) => {
        s.setDiff = s.setWins - s.setLosses
        s.goalDiff = s.goalsFor - s.goalsAgainst
        s.winRate = s.wins + s.losses > 0
          ? Math.round((s.wins / (s.wins + s.losses)) * 100)
          : 0
      })

      // Sort and assign ranks
      const sorted = Object.values(standingsMap).sort((a, b) => {
        // 1. Points (wins)
        if (b.points !== a.points) return b.points - a.points
        // 2. Set difference
        if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff
        // 3. Point difference
        if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff
        // 4. Goals for
        return b.goalsFor - a.goalsFor
      })

      sorted.forEach((s, idx) => {
        s.rank = idx + 1
      })

      return {
        name: group.name,
        standings: sorted,
        totalMatches: group.matches?.length || 0,
        completedMatches: groupMatches.length,
      }
    })
  }, [project, isTeam])

  // Overall standings (combined from all groups)
  const overallStandings = useMemo(() => {
    const allStandings: CalculatedStanding[] = []
    groupStandings.forEach((group) => {
      allStandings.push(...group.standings)
    })

    return allStandings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.setDiff !== a.setDiff) return b.setDiff - a.setDiff
      return b.goalDiff - a.goalDiff
    }).map((s, idx) => ({ ...s, rank: idx + 1 }))
  }, [groupStandings])

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

  const advanceCount = project.groupSettings?.advanceCount || 2

  return (
    <div className={styles.container}>
      <Header
        title="순위표"
        subtitle={project.name}
        gradient="linear-gradient(135deg, #4caf50 0%, #388e3c 100%)"
        showBack
        onBack={() => navigate(`/admin/project/${id}`)}
      />

      <main>
        {groupStandings.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>생성된 조가 없습니다.</p>
              <Button onClick={() => navigate(`/tournament/groups/${id}`)}>
                조 편성하러 가기
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* Group Standings */}
            {groupStandings.map((group) => (
              <Card key={group.name} className={styles.groupCard}>
                <div className={styles.groupHeader}>
                  <h3 className={styles.groupName}>{group.name}조</h3>
                  <span className={styles.groupProgress}>
                    {group.completedMatches}/{group.totalMatches} 경기 완료
                  </span>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.rankCol}>#</th>
                        <th className={styles.nameCol}>이름</th>
                        <th>승</th>
                        <th>패</th>
                        <th>세트</th>
                        <th>득실</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.standings.map((standing) => (
                        <tr
                          key={standing.name}
                          className={standing.rank <= advanceCount ? styles.advancing : ''}
                        >
                          <td className={styles.rankCol}>
                            <span className={`${styles.rank} ${standing.rank <= advanceCount ? styles.top : ''}`}>
                              {standing.rank}
                            </span>
                          </td>
                          <td className={styles.nameCol}>{standing.name}</td>
                          <td className={styles.wins}>{standing.wins}</td>
                          <td className={styles.losses}>{standing.losses}</td>
                          <td>{standing.setWins}-{standing.setLosses}</td>
                          <td className={standing.goalDiff > 0 ? styles.positive : standing.goalDiff < 0 ? styles.negative : ''}>
                            {standing.goalDiff > 0 ? '+' : ''}{standing.goalDiff}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {advanceCount > 0 && (
                  <p className={styles.advanceNote}>
                    상위 {advanceCount}명 본선 진출
                  </p>
                )}
              </Card>
            ))}

            {/* Overall Standings */}
            {groupStandings.length > 1 && (
              <Card>
                <h3 className={styles.sectionTitle}>전체 순위</h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.rankCol}>#</th>
                        <th className={styles.nameCol}>이름</th>
                        <th>승</th>
                        <th>패</th>
                        <th>세트</th>
                        <th>득실</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overallStandings.slice(0, 10).map((standing) => (
                        <tr key={standing.name}>
                          <td className={styles.rankCol}>
                            <span className={`${styles.rank} ${standing.rank <= 3 ? styles.top : ''}`}>
                              {standing.rank}
                            </span>
                          </td>
                          <td className={styles.nameCol}>{standing.name}</td>
                          <td className={styles.wins}>{standing.wins}</td>
                          <td className={styles.losses}>{standing.losses}</td>
                          <td>{standing.setWins}-{standing.setLosses}</td>
                          <td className={standing.goalDiff > 0 ? styles.positive : standing.goalDiff < 0 ? styles.negative : ''}>
                            {standing.goalDiff > 0 ? '+' : ''}{standing.goalDiff}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
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
