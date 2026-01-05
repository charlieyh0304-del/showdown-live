import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Header, Card, Button, Input, Modal } from '@/components/common'
import { useProjectStore } from '@/stores'
import type { Player } from '@/types'
import styles from './ManagePlayers.module.css'

export function ManagePlayers() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const projects = useProjectStore((state) => state.projects)
  const updateProject = useProjectStore((state) => state.updateProject)

  const [players, setPlayers] = useState<Player[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null)
  const [newPlayer, setNewPlayer] = useState({ name: '', club: '', seed: 0 })

  const project = projects.find((p) => p.id === parseInt(id || '0'))

  useEffect(() => {
    if (project?.players) {
      // Handle both Player[] and string[] formats
      const playerData = project.players.map((p, index) => {
        if (typeof p === 'string') {
          return { id: Date.now() + index, name: p }
        }
        return p
      })
      setPlayers(playerData)
    }
  }, [project])

  const savePlayers = (updatedPlayers: Player[]) => {
    if (!id) return
    setPlayers(updatedPlayers)
    updateProject(parseInt(id), { players: updatedPlayers })
  }

  const handleAddPlayer = () => {
    if (!newPlayer.name.trim()) return

    const player: Player = {
      id: Date.now(),
      name: newPlayer.name.trim(),
      club: newPlayer.club.trim() || undefined,
      seed: newPlayer.seed || undefined,
      createdAt: new Date().toISOString(),
    }

    savePlayers([...players, player])
    setNewPlayer({ name: '', club: '', seed: 0 })
    setShowAddModal(false)
  }

  const handleEditPlayer = () => {
    if (!editingPlayer || !editingPlayer.name.trim()) return

    const updatedPlayers = players.map((p) =>
      p.id === editingPlayer.id ? editingPlayer : p
    )
    savePlayers(updatedPlayers)
    setEditingPlayer(null)
    setShowEditModal(false)
  }

  const handleDeletePlayer = (playerId: number) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return
    savePlayers(players.filter((p) => p.id !== playerId))
  }

  const handleBulkAdd = () => {
    const input = prompt('선수 이름을 줄바꿈으로 구분해서 입력하세요:')
    if (!input) return

    const names = input.split('\n').map((n) => n.trim()).filter((n) => n)
    const newPlayers: Player[] = names.map((name, index) => ({
      id: Date.now() + index,
      name,
      createdAt: new Date().toISOString(),
    }))

    savePlayers([...players, ...newPlayers])
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
        title="선수 관리"
        subtitle={`${project.name} · ${players.length}명`}
        gradient="linear-gradient(135deg, #2196f3 0%, #1976d2 100%)"
        showBack
        onBack={() => navigate(`/admin/project/${id}`)}
      />

      <main>
        {/* Actions */}
        <Card>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              + 선수 추가
            </Button>
            <Button onClick={handleBulkAdd}>
              일괄 추가
            </Button>
          </div>
        </Card>

        {/* Player List */}
        <Card>
          <h3 className={styles.sectionTitle}>선수 목록</h3>
          {players.length === 0 ? (
            <div className={styles.emptyState}>
              <p>등록된 선수가 없습니다.</p>
              <p>선수를 추가해주세요.</p>
            </div>
          ) : (
            <div className={styles.playerList}>
              {players.map((player, index) => (
                <div key={player.id} className={styles.playerItem}>
                  <div className={styles.playerIndex}>{index + 1}</div>
                  <div className={styles.playerInfo}>
                    <div className={styles.playerName}>{player.name}</div>
                    {player.club && (
                      <div className={styles.playerClub}>{player.club}</div>
                    )}
                    {player.seed && (
                      <span className={styles.seedBadge}>시드 {player.seed}</span>
                    )}
                  </div>
                  <div className={styles.playerActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => {
                        setEditingPlayer({ ...player })
                        setShowEditModal(true)
                      }}
                    >
                      수정
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDeletePlayer(player.id)}
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

      {/* Add Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="선수 추가"
      >
        <div className={styles.modalContent}>
          <Input
            label="이름 *"
            value={newPlayer.name}
            onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
            placeholder="선수 이름"
          />
          <Input
            label="소속"
            value={newPlayer.club}
            onChange={(e) => setNewPlayer({ ...newPlayer, club: e.target.value })}
            placeholder="소속 클럽/학교"
          />
          <Input
            label="시드"
            type="number"
            value={newPlayer.seed || ''}
            onChange={(e) => setNewPlayer({ ...newPlayer, seed: parseInt(e.target.value) || 0 })}
            placeholder="시드 순위 (선택)"
          />
          <div className={styles.modalActions}>
            <Button onClick={() => setShowAddModal(false)}>취소</Button>
            <Button variant="primary" onClick={handleAddPlayer}>추가</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="선수 수정"
      >
        {editingPlayer && (
          <div className={styles.modalContent}>
            <Input
              label="이름 *"
              value={editingPlayer.name}
              onChange={(e) => setEditingPlayer({ ...editingPlayer, name: e.target.value })}
            />
            <Input
              label="소속"
              value={editingPlayer.club || ''}
              onChange={(e) => setEditingPlayer({ ...editingPlayer, club: e.target.value })}
            />
            <Input
              label="시드"
              type="number"
              value={editingPlayer.seed || ''}
              onChange={(e) => setEditingPlayer({ ...editingPlayer, seed: parseInt(e.target.value) || undefined })}
            />
            <div className={styles.modalActions}>
              <Button onClick={() => setShowEditModal(false)}>취소</Button>
              <Button variant="primary" onClick={handleEditPlayer}>저장</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
