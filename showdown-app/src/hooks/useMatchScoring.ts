import { useCallback } from 'react'
import { useMatchStore } from '@/stores'
import type { Match, ScoreHistory, SetScore } from '@/types'

// Showdown scoring rules (IBSA)
const DEFAULT_POINTS_TO_WIN = 11
const DEFAULT_MIN_LEAD = 2
const DEFAULT_SETS_TO_WIN = 2
const SERVE_CHANGE_INTERVAL = 2

export interface ScoringOptions {
  pointsToWin?: number
  minLead?: number
  setsToWin?: number
}

export function useMatchScoring(options: ScoringOptions = {}) {
  const {
    pointsToWin = DEFAULT_POINTS_TO_WIN,
    minLead = DEFAULT_MIN_LEAD,
    setsToWin = DEFAULT_SETS_TO_WIN,
  } = options

  const currentMatch = useMatchStore((state) => state.currentMatch)
  const setCurrentMatch = useMatchStore((state) => state.setCurrentMatch)
  const addToHistory = useMatchStore((state) => state.addToHistory)
  const undoLastAction = useMatchStore((state) => state.undoLastAction)

  // Check if a player has won the current set
  const checkSetWin = useCallback(
    (score1: number, score2: number): 1 | 2 | null => {
      const maxScore = Math.max(score1, score2)
      const diff = Math.abs(score1 - score2)

      if (maxScore >= pointsToWin && diff >= minLead) {
        return score1 > score2 ? 1 : 2
      }
      return null
    },
    [pointsToWin, minLead]
  )

  // Check if a player has won the match
  const checkMatchWin = useCallback(
    (sets1: number, sets2: number): 1 | 2 | null => {
      if (sets1 >= setsToWin) return 1
      if (sets2 >= setsToWin) return 2
      return null
    },
    [setsToWin]
  )

  // Calculate next server based on IBSA rules
  const calculateNextServer = useCallback(
    (
      currentServer: 1 | 2,
      score1: number,
      score2: number,
      isNewSet: boolean
    ): 1 | 2 => {
      if (isNewSet) {
        // Alternate server at the start of each set
        return currentServer === 1 ? 2 : 1
      }

      const totalPoints = score1 + score2
      const isDeuce = score1 >= pointsToWin - 1 && score2 >= pointsToWin - 1

      if (isDeuce) {
        // In deuce, serve changes every point
        return currentServer === 1 ? 2 : 1
      }

      // Normal: serve changes every 2 points
      if (totalPoints > 0 && totalPoints % SERVE_CHANGE_INTERVAL === 0) {
        return currentServer === 1 ? 2 : 1
      }

      return currentServer
    },
    [pointsToWin]
  )

  // Add a point to a player
  const addScore = useCallback(
    (player: 1 | 2) => {
      if (!currentMatch) return

      const match = { ...currentMatch }
      const currentSetIndex = match.currentSet - 1

      // Ensure sets array exists
      if (!match.sets) {
        match.sets = []
      }

      // Initialize current set if needed
      if (!match.sets[currentSetIndex]) {
        match.sets[currentSetIndex] = {
          player1Score: 0,
          player2Score: 0,
          isComplete: false,
        }
      }

      const currentSetData: SetScore = { ...match.sets[currentSetIndex] }

      // Don't add points if set is complete
      if (currentSetData.isComplete) return

      // Record history before change
      const historyEntry: ScoreHistory = {
        action: 'score',
        player,
        set: match.currentSet,
        player1Score: currentSetData.player1Score,
        player2Score: currentSetData.player2Score,
        server: match.currentServer,
        timestamp: Date.now(),
      }
      addToHistory(historyEntry)

      // Update score
      if (player === 1) {
        currentSetData.player1Score += 1
        match.player1Score = (match.player1Score || 0) + 1
      } else {
        currentSetData.player2Score += 1
        match.player2Score = (match.player2Score || 0) + 1
      }

      // Check for set win
      const setWinner = checkSetWin(
        currentSetData.player1Score,
        currentSetData.player2Score
      )

      if (setWinner) {
        currentSetData.isComplete = true
        currentSetData.winner = setWinner

        if (setWinner === 1) {
          match.player1Sets = (match.player1Sets || 0) + 1
        } else {
          match.player2Sets = (match.player2Sets || 0) + 1
        }

        // Check for match win
        const matchWinner = checkMatchWin(
          match.player1Sets || 0,
          match.player2Sets || 0
        )

        if (matchWinner) {
          match.status = 'completed'
          match.winner = matchWinner
          match.endTime = new Date().toISOString()
        } else {
          // Start new set
          match.currentSet += 1
          match.sets[match.currentSet - 1] = {
            player1Score: 0,
            player2Score: 0,
            isComplete: false,
          }
          // Server alternates at start of new set
          match.currentServer = match.currentServer === 1 ? 2 : 1
        }
      } else {
        // Update server for next point
        match.currentServer = calculateNextServer(
          match.currentServer,
          currentSetData.player1Score,
          currentSetData.player2Score,
          false
        )
      }

      // Update the set data
      match.sets[currentSetIndex] = currentSetData

      setCurrentMatch(match)
      return match
    },
    [
      currentMatch,
      setCurrentMatch,
      addToHistory,
      checkSetWin,
      checkMatchWin,
      calculateNextServer,
    ]
  )

  // Undo the last action
  const undo = useCallback(() => {
    if (!currentMatch) return

    const lastAction = undoLastAction()
    if (!lastAction) return

    const match = { ...currentMatch }

    if (lastAction.action === 'score') {
      const setIndex = lastAction.set - 1

      if (match.sets && match.sets[setIndex]) {
        // Check if we need to undo a set win
        if (match.sets[setIndex].isComplete) {
          match.sets[setIndex] = {
            ...match.sets[setIndex],
            isComplete: false,
            winner: undefined,
          }

          if (lastAction.player === 1) {
            match.player1Sets = Math.max(0, (match.player1Sets || 0) - 1)
          } else {
            match.player2Sets = Math.max(0, (match.player2Sets || 0) - 1)
          }

          // If match was completed, revert
          if (match.status === 'completed') {
            match.status = 'active'
            match.winner = undefined
            match.endTime = undefined
          }
        }

        // Restore scores
        match.sets[setIndex] = {
          ...match.sets[setIndex],
          player1Score: lastAction.player1Score,
          player2Score: lastAction.player2Score,
        }

        // Restore total scores
        if (lastAction.player === 1) {
          match.player1Score = Math.max(0, (match.player1Score || 0) - 1)
        } else {
          match.player2Score = Math.max(0, (match.player2Score || 0) - 1)
        }

        // Restore server
        match.currentServer = lastAction.server

        // Handle set navigation
        if (match.currentSet !== lastAction.set) {
          match.currentSet = lastAction.set
          // Remove the new set that was created
          if (match.sets.length > lastAction.set) {
            match.sets = match.sets.slice(0, lastAction.set)
          }
        }
      }
    }

    setCurrentMatch(match)
    return match
  }, [currentMatch, setCurrentMatch, undoLastAction])

  // Start or resume a match
  const startMatch = useCallback(
    (match: Match) => {
      const updatedMatch: Match = {
        ...match,
        status: 'active',
        startTime: match.startTime || new Date().toISOString(),
        currentSet: match.currentSet || 1,
        currentServer: match.currentServer || 1,
        player1Score: match.player1Score || 0,
        player2Score: match.player2Score || 0,
        player1Sets: match.player1Sets || 0,
        player2Sets: match.player2Sets || 0,
        sets: match.sets && match.sets.length > 0
          ? match.sets
          : [{ player1Score: 0, player2Score: 0, isComplete: false }],
      }
      setCurrentMatch(updatedMatch)
      return updatedMatch
    },
    [setCurrentMatch]
  )

  // End match early (forfeit, etc.)
  const endMatch = useCallback(
    (winner?: 1 | 2, reason?: string) => {
      if (!currentMatch) return

      const match: Match = {
        ...currentMatch,
        status: 'completed',
        winner,
        endTime: new Date().toISOString(),
        notes: reason ? `${currentMatch.notes || ''} [${reason}]`.trim() : currentMatch.notes,
      }

      setCurrentMatch(match)
      return match
    },
    [currentMatch, setCurrentMatch]
  )

  // Get current set scores
  const getCurrentSetScores = useCallback(() => {
    if (!currentMatch?.sets || currentMatch.sets.length === 0) {
      return { player1: 0, player2: 0 }
    }

    const currentSetIndex = (currentMatch.currentSet || 1) - 1
    const currentSet = currentMatch.sets[currentSetIndex]

    return {
      player1: currentSet?.player1Score || 0,
      player2: currentSet?.player2Score || 0,
    }
  }, [currentMatch])

  // Check if in deuce
  const isDeuce = useCallback(() => {
    const scores = getCurrentSetScores()
    return (
      scores.player1 >= pointsToWin - 1 && scores.player2 >= pointsToWin - 1
    )
  }, [getCurrentSetScores, pointsToWin])

  // Get game point / set point / match point status
  const getPointStatus = useCallback(() => {
    if (!currentMatch) return null

    const scores = getCurrentSetScores()
    const sets1 = currentMatch.player1Sets || 0
    const sets2 = currentMatch.player2Sets || 0

    // Check for match point
    if (sets1 === setsToWin - 1 && scores.player1 >= pointsToWin - 1 && scores.player1 > scores.player2) {
      return { type: 'matchPoint', player: 1 }
    }
    if (sets2 === setsToWin - 1 && scores.player2 >= pointsToWin - 1 && scores.player2 > scores.player1) {
      return { type: 'matchPoint', player: 2 }
    }

    // Check for set point
    if (scores.player1 >= pointsToWin - 1 && scores.player1 > scores.player2) {
      return { type: 'setPoint', player: 1 }
    }
    if (scores.player2 >= pointsToWin - 1 && scores.player2 > scores.player1) {
      return { type: 'setPoint', player: 2 }
    }

    // Check for deuce
    if (isDeuce()) {
      return { type: 'deuce', player: null }
    }

    return null
  }, [currentMatch, getCurrentSetScores, setsToWin, pointsToWin, isDeuce])

  return {
    currentMatch,
    addScore,
    undo,
    startMatch,
    endMatch,
    getCurrentSetScores,
    isDeuce,
    getPointStatus,
    checkSetWin,
    checkMatchWin,
  }
}
