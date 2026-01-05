import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button, Select, Modal } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { Group, Player, Team, Match } from '@/types'
import styles from './ManageGroups.module.css'

export function ManageGroups() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)
  const updateProject = useProjectStore((state) => state.updateProject)

  const [groups, setGroups] = useState<Group[]>([])
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [groupCount, setGroupCount] = useState(2)
  const [shuffleMode, setShuffleMode] = useState<'random' | 'seed' | 'snake'>('random')

  const project = projects.find((p) => p.id === parseInt(id || '0'))
  const isTeam = project?.competitionType === 'team'
  const participants = isTeam ? (project?.teams || []) : (project?.players || [])

  useEffect(() => {
    if (project?.groups) {
      setGroups(project.groups)
    }
  }, [project])

  const saveGroups = useCallback((updatedGroups: Group[], matches?: Match[]) => {
    if (!id) return
    setGroups(updatedGroups)
    const updateData: { groups: Group[]; matches?: Match[] } = { groups: updatedGroups }
    if (matches) {
      updateData.matches = matches
    }
    updateProject(parseInt(id), updateData)
  }, [id, updateProject])

  // Shuffle array
  const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array]
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[newArray[i], newArray[j]] = [newArray[j], newArray[i]]
    }
    return newArray
  }

  // Generate groups
  const handleGenerateGroups = () => {
    if (participants.length < 2) {
      alert('참가자가 2명 이상이어야 합니다.')
      return
    }

    let sortedParticipants = [...participants]

    // Sort by mode
    if (shuffleMode === 'random') {
      sortedParticipants = shuffleArray(sortedParticipants)
    } else if (shuffleMode === 'seed') {
      sortedParticipants.sort((a, b) => {
        const seedA = (a as Player | Team).seed || 999
        const seedB = (b as Player | Team).seed || 999
        return seedA - seedB
      })
    }

    // Create groups
    const newGroups: Group[] = []
    const groupNames = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    for (let i = 0; i < groupCount; i++) {
      newGroups.push({
        name: groupNames[i] || `조${i + 1}`,
        members: [],
        players: [],
        matches: [],
        standings: [],
        isTeam,
      })
    }

    // Distribute participants
    if (shuffleMode === 'snake') {
      // Snake draft: 1,2,3,3,2,1,1,2,3...
      let direction = 1
      let groupIdx = 0
      sortedParticipants.forEach((p) => {
        const name = (p as Player | Team).name
        if (isTeam) {
          (newGroups[groupIdx].members as string[]).push(name)
        } else {
          (newGroups[groupIdx].players as string[]).push(name)
        }

        groupIdx += direction
        if (groupIdx >= groupCount) {
          groupIdx = groupCount - 1
          direction = -1
        } else if (groupIdx < 0) {
          groupIdx = 0
          direction = 1
        }
      })
    } else {
      // Round robin distribution
      sortedParticipants.forEach((p, index) => {
        const gIdx = index % groupCount
        const name = (p as Player | Team).name
        if (isTeam) {
          (newGroups[gIdx].members as string[]).push(name)
        } else {
          (newGroups[gIdx].players as string[]).push(name)
        }
      })
    }

    // Generate matches for each group
    const allMatches: Match[] = []
    newGroups.forEach((group, groupIdx) => {
      const members = isTeam ? group.members : group.players
      if (!members || members.length < 2) return

      const memberNames = members.map(m => typeof m === 'string' ? m : m.name)

      // Round robin matches
      for (let i = 0; i < memberNames.length; i++) {
        for (let j = i + 1; j < memberNames.length; j++) {
          const match: Match = {
            id: Date.now() + allMatches.length + Math.random() * 1000,
            refereePin: '',
            player1Name: memberNames[i],
            player2Name: memberNames[j],
            type: isTeam ? 'team' : 'individual',
            sets: [],
            setsToWin: project?.groupSettings?.setsPerMatch || 2,
            winScore: 11,
            currentSet: 1,
            currentServer: 1,
            serveCount: 0,
            serveSelected: false,
            status: 'pending',
            timeouts: { player1: 1, player2: 1 },
            sideChangeUsed: false,
            warmupUsed: false,
            groupIndex: groupIdx,
            groupName: group.name,
            history: [],
            createdAt: new Date().toISOString(),
          }
          allMatches.push(match)
          group.matches.push(match)
        }
      }

      // Initialize standings
      group.standings = memberNames.map(name => ({
        name,
        wins: 0,
        losses: 0,
        setWins: 0,
        setLosses: 0,
        setDiff: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0,
      }))
    })

    saveGroups(newGroups, allMatches)
    setShowGenerateModal(false)
  }

  // Clear groups
  const handleClearGroups = () => {
    if (!window.confirm('모든 조와 조별 경기를 삭제하시겠습니까?')) return

    // Remove group matches from project matches
    const remainingMatches = project?.matches?.filter(m => !m.groupName) || []
    saveGroups([], remainingMatches)
  }

  // Move participant between groups
  const handleMoveParticipant = (fromGroup: number, toGroup: number, name: string) => {
    const newGroups = [...groups]
    const memberKey = isTeam ? 'members' : 'players'

    // Remove from source group
    const fromMembers = newGroups[fromGroup][memberKey] as string[]
    const idx = fromMembers.findIndex(m => (typeof m === 'string' ? m : (m as Player).name) === name)
    if (idx > -1) {
      fromMembers.splice(idx, 1)
    }

    // Add to target group
    const toMembers = newGroups[toGroup][memberKey] as string[]
    toMembers.push(name)

    saveGroups(newGroups)
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

  const totalMatches = groups.reduce((sum, g) => sum + g.matches.length, 0)
  const completedMatches = groups.reduce(
    (sum, g) => sum + g.matches.filter(m => m.status === 'completed').length,
    0
  )

  return (
    <div className={styles.container}>
      <Header
        title="조 관리"
        subtitle={`${project.name} · ${groups.length}개 조`}
        gradient="linear-gradient(135deg, #ff9800 0%, #f57c00 100%)"
        showBack
        onBack={() => navigate(`/admin/project/${id}`)}
      />

      <main>
        {/* Actions */}
        <Card>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setShowGenerateModal(true)}>
              조 자동 편성
            </Button>
            {groups.length > 0 && (
              <Button variant="danger" onClick={handleClearGroups}>
                조 초기화
              </Button>
            )}
          </div>
          {participants.length === 0 && (
            <p className={styles.warning}>
              먼저 {isTeam ? '팀' : '선수'}을 등록해주세요.
            </p>
          )}
        </Card>

        {/* Stats */}
        {groups.length > 0 && (
          <Card>
            <div className={styles.stats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{groups.length}</span>
                <span className={styles.statLabel}>조</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{participants.length}</span>
                <span className={styles.statLabel}>{isTeam ? '팀' : '선수'}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{completedMatches}/{totalMatches}</span>
                <span className={styles.statLabel}>경기</span>
              </div>
            </div>
          </Card>
        )}

        {/* Groups */}
        {groups.length === 0 ? (
          <Card>
            <div className={styles.emptyState}>
              <p>생성된 조가 없습니다.</p>
              <p>"조 자동 편성" 버튼을 눌러주세요.</p>
            </div>
          </Card>
        ) : (
          groups.map((group, groupIndex) => {
            const members = isTeam ? group.members : group.players
            const memberNames = members?.map(m => typeof m === 'string' ? m : (m as Player).name) || []
            const groupMatches = group.matches || []
            const completed = groupMatches.filter(m => m.status === 'completed').length

            return (
              <Card key={group.name} className={styles.groupCard}>
                <div className={styles.groupHeader}>
                  <h3 className={styles.groupName}>{group.name}조</h3>
                  <span className={styles.groupMeta}>
                    {memberNames.length}명 · {completed}/{groupMatches.length}경기
                  </span>
                </div>

                <div className={styles.memberList}>
                  {memberNames.map((name, idx) => (
                    <div key={idx} className={styles.memberItem}>
                      <span className={styles.memberIndex}>{idx + 1}</span>
                      <span className={styles.memberName}>{name}</span>
                      {groups.length > 1 && (
                        <select
                          className={styles.moveSelect}
                          value=""
                          onChange={(e) => {
                            const toGroup = parseInt(e.target.value)
                            if (!isNaN(toGroup)) {
                              handleMoveParticipant(groupIndex, toGroup, name)
                            }
                          }}
                        >
                          <option value="">이동</option>
                          {groups.map((g, i) =>
                            i !== groupIndex && (
                              <option key={i} value={i}>{g.name}조로</option>
                            )
                          )}
                        </select>
                      )}
                    </div>
                  ))}
                </div>

                {/* Group Matches */}
                {groupMatches.length > 0 && (
                  <div className={styles.matchList}>
                    <h4 className={styles.matchListTitle}>경기 목록</h4>
                    {groupMatches.slice(0, 5).map((match) => (
                      <div key={match.id} className={styles.matchItem}>
                        <span className={`${styles.matchStatus} ${styles[match.status]}`}>
                          {match.status === 'completed' ? '완료' : match.status === 'active' ? '진행중' : '대기'}
                        </span>
                        <span className={styles.matchPlayers}>
                          {match.player1Name} vs {match.player2Name}
                        </span>
                        {match.status === 'completed' && (
                          <span className={styles.matchScore}>
                            {match.player1Sets} - {match.player2Sets}
                          </span>
                        )}
                      </div>
                    ))}
                    {groupMatches.length > 5 && (
                      <p className={styles.moreMatches}>+{groupMatches.length - 5}개 더</p>
                    )}
                  </div>
                )}
              </Card>
            )
          })
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
        title="조 자동 편성"
      >
        <div className={styles.modalContent}>
          <p className={styles.modalInfo}>
            총 {participants.length}명의 {isTeam ? '팀' : '선수'}를 조로 나눕니다.
          </p>

          <Select
            label="조 개수"
            value={groupCount.toString()}
            onChange={(e) => setGroupCount(parseInt(e.target.value))}
            options={[
              { value: '2', label: '2개 조' },
              { value: '3', label: '3개 조' },
              { value: '4', label: '4개 조' },
              { value: '5', label: '5개 조' },
              { value: '6', label: '6개 조' },
              { value: '8', label: '8개 조' },
            ]}
          />

          <Select
            label="배정 방식"
            value={shuffleMode}
            onChange={(e) => setShuffleMode(e.target.value as 'random' | 'seed' | 'snake')}
            options={[
              { value: 'random', label: '랜덤 배정' },
              { value: 'seed', label: '시드 순 배정' },
              { value: 'snake', label: '스네이크 드래프트 (시드 기준)' },
            ]}
          />

          <p className={styles.modalNote}>
            조별 리그 경기가 자동으로 생성됩니다.
          </p>

          <div className={styles.modalActions}>
            <Button onClick={() => setShowGenerateModal(false)}>취소</Button>
            <Button variant="primary" onClick={handleGenerateGroups}>생성</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
