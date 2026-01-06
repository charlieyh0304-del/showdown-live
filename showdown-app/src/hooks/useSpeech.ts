/**
 * 음성 안내 훅 (Web Speech API)
 * 시각장애인을 위한 점수 및 경기 상황 음성 안내
 */

import { useCallback, useEffect, useRef } from 'react'
import { useAccessibilityStore } from '@/stores'

// 한국어 음성 설정
const SPEECH_LANG = 'ko-KR'
const SPEECH_RATE = 1.0
const SPEECH_PITCH = 1.0

export function useSpeech() {
  const { voiceEnabled, voiceVolume } = useAccessibilityStore()
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  // 음성 합성 초기화
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis

      // 음성 목록 로드
      const loadVoices = () => {
        voicesRef.current = synthRef.current?.getVoices() || []
      }

      loadVoices()
      synthRef.current.addEventListener('voiceschanged', loadVoices)

      return () => {
        synthRef.current?.removeEventListener('voiceschanged', loadVoices)
      }
    }
  }, [])

  // 한국어 음성 찾기
  const getKoreanVoice = useCallback(() => {
    return voicesRef.current.find(voice =>
      voice.lang.startsWith('ko') || voice.lang.includes('KR')
    ) || voicesRef.current[0]
  }, [])

  // 텍스트 읽기
  const speak = useCallback((text: string, priority: boolean = false) => {
    if (!voiceEnabled || !synthRef.current) return

    // 우선순위가 높으면 기존 음성 취소
    if (priority) {
      synthRef.current.cancel()
    }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = SPEECH_LANG
    utterance.rate = SPEECH_RATE
    utterance.pitch = SPEECH_PITCH
    utterance.volume = voiceVolume

    const koreanVoice = getKoreanVoice()
    if (koreanVoice) {
      utterance.voice = koreanVoice
    }

    synthRef.current.speak(utterance)
  }, [voiceEnabled, voiceVolume, getKoreanVoice])

  // 음성 중지
  const stop = useCallback(() => {
    synthRef.current?.cancel()
  }, [])

  // 점수 안내
  const announceScore = useCallback((
    player1Name: string,
    player1Score: number,
    player2Name: string,
    player2Score: number
  ) => {
    speak(`${player1Score} 대 ${player2Score}`, true)
  }, [speak])

  // 세트 점수 안내
  const announceSetScore = useCallback((
    player1Name: string,
    player1Sets: number,
    player2Name: string,
    player2Sets: number
  ) => {
    speak(`세트 스코어, ${player1Name} ${player1Sets}, ${player2Name} ${player2Sets}`, true)
  }, [speak])

  // 득점 안내
  const announcePoint = useCallback((
    playerName: string,
    newScore: number
  ) => {
    speak(`${playerName} 득점, ${newScore}점`)
  }, [speak])

  // 세트 승리 안내
  const announceSetWin = useCallback((
    winnerName: string,
    setNumber: number,
    winnerScore: number,
    loserScore: number
  ) => {
    speak(`${setNumber}세트 종료. ${winnerName} 승리. ${winnerScore} 대 ${loserScore}`, true)
  }, [speak])

  // 경기 승리 안내
  const announceMatchWin = useCallback((
    winnerName: string,
    winnerSets: number,
    loserSets: number
  ) => {
    speak(`경기 종료! ${winnerName} 승리! ${winnerSets} 대 ${loserSets}`, true)
  }, [speak])

  // 서브 안내
  const announceServe = useCallback((playerName: string) => {
    speak(`${playerName} 서브`)
  }, [speak])

  // 서브 교대 안내
  const announceServeChange = useCallback((playerName: string) => {
    speak(`서브 교대. ${playerName} 서브`)
  }, [speak])

  // 타임아웃 안내
  const announceTimeout = useCallback((playerName: string) => {
    speak(`${playerName} 타임아웃`)
  }, [speak])

  // 경기 시작 안내
  const announceMatchStart = useCallback((
    player1Name: string,
    player2Name: string,
    serverName: string
  ) => {
    speak(`경기 시작. ${player1Name} 대 ${player2Name}. ${serverName} 서브로 시작합니다.`, true)
  }, [speak])

  // 새 세트 시작 안내
  const announceNewSet = useCallback((setNumber: number, serverName: string) => {
    speak(`${setNumber}세트 시작. ${serverName} 서브`, true)
  }, [speak])

  return {
    speak,
    stop,
    announceScore,
    announceSetScore,
    announcePoint,
    announceSetWin,
    announceMatchWin,
    announceServe,
    announceServeChange,
    announceTimeout,
    announceMatchStart,
    announceNewSet,
    isSupported: typeof window !== 'undefined' && 'speechSynthesis' in window
  }
}
