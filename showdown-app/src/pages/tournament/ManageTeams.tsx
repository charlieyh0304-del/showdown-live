import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button, Input, Modal } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { Team, TeamMember } from '@/types'
import styles from './ManageTeams.module.css'

export function ManageTeams() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)
  const updateProject = useProjectStore((state) => state.updateProject)

  const [teams, setTeams] = useState<Team[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [newTeam, setNewTeam] = useState({ name: '', club: '', seed: 0 })
  const [newMember, setNewMember] = useState({ name: '', position: '' })

  const project = projects.find((p) => p.id === parseInt(id || '0'))

  useEffect(() => {
    if (project?.teams) {
      setTeams(project.teams)
    }
  }, [project])

  const saveTeams = (updatedTeams: Team[]) => {
    if (!id) return
    setTeams(updatedTeams)
    updateProject(parseInt(id), { teams: updatedTeams })
  }

  const handleAddTeam = () => {
    if (!newTeam.name.trim()) return

    const team: Team = {
      id: Date.now(),
      name: newTeam.name.trim(),
      club: newTeam.club.trim() || undefined,
      seed: newTeam.seed || undefined,
      members: [],
      createdAt: new Date().toISOString(),
    }

    saveTeams([...teams, team])
    setNewTeam({ name: '', club: '', seed: 0 })
    setShowAddModal(false)
  }

  const handleEditTeam = () => {
    if (!editingTeam || !editingTeam.name.trim()) return

    const updatedTeams = teams.map((t) =>
      t.id === editingTeam.id ? editingTeam : t
    )
    saveTeams(updatedTeams)
    setEditingTeam(null)
    setShowEditModal(false)
  }

  const handleDeleteTeam = (teamId: number) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return
    saveTeams(teams.filter((t) => t.id !== teamId))
  }

  const handleAddMember = () => {
    if (!editingTeam || !newMember.name.trim()) return

    const member: TeamMember = {
      id: Date.now(),
      name: newMember.name.trim(),
      position: newMember.position.trim() || undefined,
    }

    const updatedTeam = {
      ...editingTeam,
      members: [...(editingTeam.members || []), member],
    }
    setEditingTeam(updatedTeam)
    setNewMember({ name: '', position: '' })
  }

  const handleDeleteMember = (memberId: number) => {
    if (!editingTeam) return

    const updatedTeam = {
      ...editingTeam,
      members: editingTeam.members?.filter((m) => m.id !== memberId) || [],
    }
    setEditingTeam(updatedTeam)
  }

  const handleSaveMembers = () => {
    if (!editingTeam) return

    const updatedTeams = teams.map((t) =>
      t.id === editingTeam.id ? editingTeam : t
    )
    saveTeams(updatedTeams)
    setShowMembersModal(false)
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

  return (
    <div className={styles.container}>
      <Header
        title="팀 관리"
        subtitle={`${project.name} · ${teams.length}팀`}
        gradient="linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)"
        showBack
        onBack={() => navigate(`/admin/project/${id}`)}
      />

      <main>
        {/* Actions */}
        <Card>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              + 팀 추가
            </Button>
          </div>
        </Card>

        {/* Team List */}
        <Card>
          <h3 className={styles.sectionTitle}>팀 목록</h3>
          {teams.length === 0 ? (
            <div className={styles.emptyState}>
              <p>등록된 팀이 없습니다.</p>
              <p>팀을 추가해주세요.</p>
            </div>
          ) : (
            <div className={styles.teamList}>
              {teams.map((team, index) => (
                <div key={team.id} className={styles.teamItem}>
                  <div className={styles.teamIndex}>{index + 1}</div>
                  <div className={styles.teamInfo}>
                    <div className={styles.teamName}>{team.name}</div>
                    {team.club && (
                      <div className={styles.teamClub}>{team.club}</div>
                    )}
                    <div className={styles.teamMeta}>
                      <span className={styles.memberCount}>
                        {team.members?.length || 0}명
                      </span>
                      {team.seed && (
                        <span className={styles.seedBadge}>시드 {team.seed}</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.teamActions}>
                    <button
                      className={styles.membersBtn}
                      onClick={() => {
                        setEditingTeam({ ...team })
                        setShowMembersModal(true)
                      }}
                    >
                      멤버
                    </button>
                    <button
                      className={styles.editBtn}
                      onClick={() => {
                        setEditingTeam({ ...team })
                        setShowEditModal(true)
                      }}
                    >
                      수정
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDeleteTeam(team.id)}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Back Button */}
        <Card>
          <Button onClick={() => navigate(`/admin/project/${id}`)}>
            ← 대회로 돌아가기
          </Button>
        </Card>
      </main>

      {/* Add Team Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="팀 추가"
      >
        <div className={styles.modalContent}>
          <Input
            label="팀명 *"
            value={newTeam.name}
            onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
            placeholder="팀 이름"
          />
          <Input
            label="소속"
            value={newTeam.club}
            onChange={(e) => setNewTeam({ ...newTeam, club: e.target.value })}
            placeholder="소속 클럽/학교"
          />
          <Input
            label="시드"
            type="number"
            value={newTeam.seed || ''}
            onChange={(e) => setNewTeam({ ...newTeam, seed: parseInt(e.target.value) || 0 })}
            placeholder="시드 순위 (선택)"
          />
          <div className={styles.modalActions}>
            <Button onClick={() => setShowAddModal(false)}>취소</Button>
            <Button variant="primary" onClick={handleAddTeam}>추가</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Team Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="팀 수정"
      >
        {editingTeam && (
          <div className={styles.modalContent}>
            <Input
              label="팀명 *"
              value={editingTeam.name}
              onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
            />
            <Input
              label="소속"
              value={editingTeam.club || ''}
              onChange={(e) => setEditingTeam({ ...editingTeam, club: e.target.value })}
            />
            <Input
              label="시드"
              type="number"
              value={editingTeam.seed || ''}
              onChange={(e) => setEditingTeam({ ...editingTeam, seed: parseInt(e.target.value) || undefined })}
            />
            <div className={styles.modalActions}>
              <Button onClick={() => setShowEditModal(false)}>취소</Button>
              <Button variant="primary" onClick={handleEditTeam}>저장</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Members Modal */}
      <Modal
        isOpen={showMembersModal}
        onClose={() => setShowMembersModal(false)}
        title={`${editingTeam?.name || ''} 멤버 관리`}
      >
        {editingTeam && (
          <div className={styles.modalContent}>
            {/* Add Member Form */}
            <div className={styles.addMemberForm}>
              <Input
                label="이름"
                value={newMember.name}
                onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                placeholder="멤버 이름"
              />
              <Input
                label="포지션"
                value={newMember.position}
                onChange={(e) => setNewMember({ ...newMember, position: e.target.value })}
                placeholder="포지션 (선택)"
              />
              <Button onClick={handleAddMember}>+ 멤버 추가</Button>
            </div>

            {/* Member List */}
            <div className={styles.memberList}>
              {editingTeam.members?.length === 0 ? (
                <p className={styles.noMembers}>등록된 멤버가 없습니다.</p>
              ) : (
                editingTeam.members?.map((member) => (
                  <div key={member.id} className={styles.memberItem}>
                    <div className={styles.memberInfo}>
                      <span className={styles.memberName}>{member.name}</span>
                      {member.position && (
                        <span className={styles.memberPosition}>{member.position}</span>
                      )}
                    </div>
                    <button
                      className={styles.deleteMemberBtn}
                      onClick={() => handleDeleteMember(member.id)}
                    >
                      X
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className={styles.modalActions}>
              <Button onClick={() => setShowMembersModal(false)}>취소</Button>
              <Button variant="primary" onClick={handleSaveMembers}>저장</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
