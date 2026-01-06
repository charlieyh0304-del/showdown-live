import { useCallback, useEffect, useRef } from 'react'
import { useAccessibilityStore } from '../stores/useAccessibilityStore'

const SPEECH_LANG = 'ko-KR'
const SPEECH_RATE = 1.0
const SPEECH_PITCH = 1.0

export function useSpeech() {
  const { voiceEnabled, voiceVolume } = useAccessibilityStore()
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis

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

  const getKoreanVoice = useCallback(() => {
    return voicesRef.current.find(voice =>
      voice.lang.startsWith('ko') || voice.lang.includes('KR')
    ) || voicesRef.current[0]
  }, [])

  const speak = useCallback((text: string, priority: boolean = false) => {
    if (!voiceEnabled || !synthRef.current) return

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

  const stop = useCallback(() => {
    synthRef.current?.cancel()
  }, [])

  const announceScore = useCallback((p1Score: number, p2Score: number) => {
    speak(`${p1Score} 대 ${p2Score}`, true)
  }, [speak])

  const announcePoint = useCallback((playerName: string, newScore: number) => {
    speak(`${playerName} 득점, ${newScore}점`)
  }, [speak])

  const announceSetWin = useCallback((winnerName: string, setNum: number, winScore: number, loseScore: number) => {
    speak(`${setNum}세트 종료. ${winnerName} 승리. ${winScore} 대 ${loseScore}`, true)
  }, [speak])

  const announceMatchWin = useCallback((winnerName: string, winSets: number, loseSets: number) => {
    speak(`경기 종료! ${winnerName} 승리! ${winSets} 대 ${loseSets}`, true)
  }, [speak])

  const announceServeChange = useCallback((playerName: string) => {
    speak(`서브 교대. ${playerName} 서브`)
  }, [speak])

  const announceMatchStart = useCallback((p1: string, p2: string, server: string) => {
    speak(`경기 시작. ${p1} 대 ${p2}. ${server} 서브로 시작합니다.`, true)
  }, [speak])

  const announceNewSet = useCallback((setNum: number, server: string) => {
    speak(`${setNum}세트 시작. ${server} 서브`, true)
  }, [speak])

  return {
    speak, stop, announceScore, announcePoint, announceSetWin,
    announceMatchWin, announceServeChange, announceMatchStart, announceNewSet,
    isSupported: typeof window !== 'undefined' && 'speechSynthesis' in window
  }
}
