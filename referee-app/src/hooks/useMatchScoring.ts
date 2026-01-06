import { useCallback } from 'react'
import { useMatchStore } from '../stores/useMatchStore'
import { useAccessibilityStore } from '../stores/useAccessibilityStore'
import { useSpeech } from './useSpeech'
import type { Match } from '../types'

const POINTS_TO_WIN_SET = 11
const MIN_LEAD_TO_WIN = 2

export function useMatchScoring() {
  const { currentMatch, setCurrentMatch, addToHistory, popHistory, clearHistory } = useMatchStore()
  const { announceScore, announceServe } = useAccessibilityStore()
  const speech = useSpeech()

  const saveState = useCallback(() => {
    if (!currentMatch) return
    addToHistory({
      player: 1,
      player1Score: currentMatch.sets[currentMatch.currentSet - 1]?.player1Score || 0,
      player2Score: currentMatch.sets[currentMatch.currentSet - 1]?.player2Score || 0,
      player1Sets: currentMatch.player1Sets || 0,
      player2Sets: currentMatch.player2Sets || 0,
      currentSet: currentMatch.currentSet,
      currentServer: currentMatch.currentServer,
      sets: JSON.parse(JSON.stringify(currentMatch.sets)),
      timestamp: Date.now()
    })
  }, [currentMatch, addToHistory])

  const checkSetWin = useCallback((p1Score: number, p2Score: number): 1 | 2 | null => {
    if (p1Score >= POINTS_TO_WIN_SET && p1Score - p2Score >= MIN_LEAD_TO_WIN) return 1
    if (p2Score >= POINTS_TO_WIN_SET && p2Score - p1Score >= MIN_LEAD_TO_WIN) return 2
    return null
  }, [])

  const getNextServer = useCallback((p1Score: number, p2Score: number, currentServer: 1 | 2): 1 | 2 => {
    const totalPoints = p1Score + p2Score
    // Deuce (10-10 이상): 매 포인트마다 서브 교대
    if (p1Score >= 10 && p2Score >= 10) {
      return totalPoints % 2 === 0 ? currentServer : (currentServer === 1 ? 2 : 1)
    }
    // 일반: 2점마다 서브 교대
    return Math.floor(totalPoints / 2) % 2 === 0 ? currentServer : (currentServer === 1 ? 2 : 1)
  }, [])

  const addScore = useCallback((player: 1 | 2): Match | null => {
    if (!currentMatch || currentMatch.status !== 'active') return null

    saveState()

    const currentSetIndex = currentMatch.currentSet - 1
    const sets = [...currentMatch.sets]
    if (!sets[currentSetIndex]) {
      sets[currentSetIndex] = { player1Score: 0, player2Score: 0 }
    }

    const currentSetData = { ...sets[currentSetIndex] }
    if (player === 1) currentSetData.player1Score++
    else currentSetData.player2Score++

    sets[currentSetIndex] = currentSetData

    // 음성 안내
    if (announceScore) {
      speech.announceScore(currentSetData.player1Score, currentSetData.player2Score)
    }

    // 서브 교대 체크
    const prevServer = currentMatch.currentServer
    const newServer = getNextServer(currentSetData.player1Score, currentSetData.player2Score, currentMatch.currentServer)
    if (newServer !== prevServer && announceServe) {
      const serverName = newServer === 1 ? currentMatch.player1Name : currentMatch.player2Name
      speech.announceServeChange(serverName)
    }

    const setWinner = checkSetWin(currentSetData.player1Score, currentSetData.player2Score)

    if (setWinner) {
      // 세트 종료
      currentSetData.isComplete = true
      currentSetData.winner = setWinner
      sets[currentSetIndex] = currentSetData

      const newP1Sets = (currentMatch.player1Sets || 0) + (setWinner === 1 ? 1 : 0)
      const newP2Sets = (currentMatch.player2Sets || 0) + (setWinner === 2 ? 1 : 0)

      const winnerName = setWinner === 1 ? currentMatch.player1Name : currentMatch.player2Name
      speech.announceSetWin(winnerName, currentMatch.currentSet,
        Math.max(currentSetData.player1Score, currentSetData.player2Score),
        Math.min(currentSetData.player1Score, currentSetData.player2Score))

      // 경기 종료 체크
      if (newP1Sets >= currentMatch.setsToWin || newP2Sets >= currentMatch.setsToWin) {
        const matchWinner = newP1Sets >= currentMatch.setsToWin ? 1 : 2
        const finalWinnerName = matchWinner === 1 ? currentMatch.player1Name : currentMatch.player2Name

        speech.announceMatchWin(finalWinnerName, Math.max(newP1Sets, newP2Sets), Math.min(newP1Sets, newP2Sets))

        const updatedMatch: Match = {
          ...currentMatch,
          sets,
          player1Sets: newP1Sets,
          player2Sets: newP2Sets,
          status: 'completed',
          winner: matchWinner,
          endTime: new Date().toISOString()
        }
        setCurrentMatch(updatedMatch)
        return updatedMatch
      }

      // 다음 세트 시작
      const nextSet = currentMatch.currentSet + 1
      const nextServer = setWinner === 1 ? 2 : 1
      sets[nextSet - 1] = { player1Score: 0, player2Score: 0 }

      speech.announceNewSet(nextSet, nextServer === 1 ? currentMatch.player1Name : currentMatch.player2Name)

      const updatedMatch: Match = {
        ...currentMatch,
        sets,
        player1Sets: newP1Sets,
        player2Sets: newP2Sets,
        currentSet: nextSet,
        currentServer: nextServer
      }
      setCurrentMatch(updatedMatch)
      return updatedMatch
    }

    // 일반 득점
    const updatedMatch: Match = {
      ...currentMatch,
      sets,
      currentServer: newServer
    }
    setCurrentMatch(updatedMatch)
    return updatedMatch
  }, [currentMatch, setCurrentMatch, saveState, checkSetWin, getNextServer, speech, announceScore, announceServe])

  const undo = useCallback((): Match | null => {
    const lastState = popHistory()
    if (!lastState || !currentMatch) return null

    const updatedMatch: Match = {
      ...currentMatch,
      sets: lastState.sets,
      player1Sets: lastState.player1Sets,
      player2Sets: lastState.player2Sets,
      currentSet: lastState.currentSet,
      currentServer: lastState.currentServer,
      status: 'active',
      winner: undefined
    }
    setCurrentMatch(updatedMatch)
    return updatedMatch
  }, [currentMatch, setCurrentMatch, popHistory])

  const startMatch = useCallback((match: Match) => {
    const initializedMatch: Match = {
      ...match,
      status: 'active',
      sets: match.sets?.length ? match.sets : [{ player1Score: 0, player2Score: 0 }],
      currentSet: match.currentSet || 1,
      currentServer: match.currentServer || 1,
      player1Sets: match.player1Sets || 0,
      player2Sets: match.player2Sets || 0,
      startTime: match.startTime || new Date().toISOString()
    }
    setCurrentMatch(initializedMatch)
    clearHistory()

    speech.announceMatchStart(
      match.player1Name,
      match.player2Name,
      (match.currentServer || 1) === 1 ? match.player1Name : match.player2Name
    )

    return initializedMatch
  }, [setCurrentMatch, clearHistory, speech])

  const endMatch = useCallback((winner?: 1 | 2): Match | null => {
    if (!currentMatch) return null

    const updatedMatch: Match = {
      ...currentMatch,
      status: 'completed',
      winner,
      endTime: new Date().toISOString()
    }
    setCurrentMatch(updatedMatch)

    if (winner) {
      const winnerName = winner === 1 ? currentMatch.player1Name : currentMatch.player2Name
      speech.announceMatchWin(winnerName, currentMatch.player1Sets || 0, currentMatch.player2Sets || 0)
    }

    return updatedMatch
  }, [currentMatch, setCurrentMatch, speech])

  const getCurrentSetScores = useCallback(() => {
    if (!currentMatch) return { player1Score: 0, player2Score: 0 }
    const set = currentMatch.sets?.[currentMatch.currentSet - 1]
    return {
      player1Score: set?.player1Score || 0,
      player2Score: set?.player2Score || 0
    }
  }, [currentMatch])

  return {
    currentMatch,
    addScore,
    undo,
    startMatch,
    endMatch,
    getCurrentSetScores,
    clearHistory
  }
}
