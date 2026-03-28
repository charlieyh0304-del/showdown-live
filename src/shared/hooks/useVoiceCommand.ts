import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceAction {
  type: 'goal' | 'foul' | 'dead_ball' | 'timeout_player' | 'timeout_medical' | 'timeout_referee' | 'penalty' | 'undo';
  player?: 1 | 2;
  foulType?: string;
  penaltyType?: string;
}

interface VoiceCommandConfig {
  player1Name: string;
  player2Name: string;
  onAction: (action: VoiceAction) => void;
  enabled?: boolean;
}

// Korean keyword maps for fuzzy matching
const FOUL_KEYWORDS: Record<string, string> = {
  '서브': 'irregular_serve',
  '이레귤러': 'irregular_serve',
  '센터보드': 'centerboard',
  '센터': 'centerboard',
  '바디': 'body_touch',
  '바디터치': 'body_touch',
  '수비': 'illegal_defense',
  '일리걸': 'illegal_defense',
  '디펜스': 'illegal_defense',
  '아웃': 'out',
  '홀딩': 'ball_holding',
  '볼홀딩': 'ball_holding',
  '마스크': 'mask_touch',
};

const PENALTY_KEYWORDS: Record<string, string> = {
  '테이블': 'penalty_table_pushing',
  '푸싱': 'penalty_table_pushing',
  '전자': 'penalty_electronic',
  '일렉': 'penalty_electronic',
  '대화': 'penalty_talking',
  '토킹': 'penalty_talking',
  '말': 'penalty_talking',
};

function matchPlayer(transcript: string, p1Name: string, p2Name: string): 1 | 2 | null {
  const t = transcript.toLowerCase();
  // Check exact name match first
  if (p1Name && t.includes(p1Name.toLowerCase())) return 1;
  if (p2Name && t.includes(p2Name.toLowerCase())) return 2;
  // Number-based: "1번", "선수1", "일번"
  if (/[1일]번|선수\s*1|왼쪽|좌측/.test(t)) return 1;
  if (/[2이]번|선수\s*2|오른쪽|우측/.test(t)) return 2;
  return null;
}

function parseCommand(transcript: string, p1Name: string, p2Name: string): VoiceAction | null {
  const t = transcript.trim();
  if (!t) return null;

  // Undo
  if (/취소|되돌|실행\s*취소|언두/.test(t)) {
    return { type: 'undo' };
  }

  // Dead ball
  if (/데드|dead/i.test(t)) {
    return { type: 'dead_ball' };
  }

  // Referee timeout
  if (/레프리|레퍼리|심판\s*타임/.test(t)) {
    return { type: 'timeout_referee' };
  }

  // Medical timeout
  if (/메디컬|의료|부상/.test(t)) {
    const player = matchPlayer(t, p1Name, p2Name);
    return { type: 'timeout_medical', player: player ?? undefined };
  }

  // Player timeout
  if (/타임아웃|타임\s*아웃|타임/.test(t) && !/레프리|메디컬/.test(t)) {
    const player = matchPlayer(t, p1Name, p2Name);
    return { type: 'timeout_player', player: player ?? undefined };
  }

  // Penalty
  if (/페널티|벌점|벌칙/.test(t)) {
    const player = matchPlayer(t, p1Name, p2Name);
    let penaltyType: string | undefined;
    for (const [keyword, type] of Object.entries(PENALTY_KEYWORDS)) {
      if (t.includes(keyword)) { penaltyType = type; break; }
    }
    return { type: 'penalty', player: player ?? undefined, penaltyType };
  }

  // Goal
  if (/골|goal|득점|goooal/i.test(t)) {
    const player = matchPlayer(t, p1Name, p2Name);
    return { type: 'goal', player: player ?? undefined };
  }

  // Foul (check foul keywords)
  for (const [keyword, foulType] of Object.entries(FOUL_KEYWORDS)) {
    if (t.includes(keyword)) {
      const player = matchPlayer(t, p1Name, p2Name);
      return { type: 'foul', player: player ?? undefined, foulType };
    }
  }

  // Generic foul
  if (/파울|반칙|foul/i.test(t)) {
    const player = matchPlayer(t, p1Name, p2Name);
    return { type: 'foul', player: player ?? undefined };
  }

  // Last resort: just player name → treat as needing more info
  const player = matchPlayer(t, p1Name, p2Name);
  if (player) {
    // If they just said a name, might be goal (most common action)
    return { type: 'goal', player };
  }

  return null;
}

export function useVoiceCommand({ player1Name, player2Name, onAction, enabled = true }: VoiceCommandConfig) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SpeechRecognition);
  }, []);

  const startListening = useCallback(() => {
    if (!enabled || isListening) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      setTranscript(finalTranscript || interimTranscript);

      if (finalTranscript) {
        const action = parseCommand(finalTranscript, player1Name, player2Name);
        if (action) {
          onActionRef.current(action);
        }
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      setTranscript('');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [enabled, isListening, player1Name, player2Name]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  return { isListening, transcript, supported, toggleListening, startListening, stopListening };
}

// Type declarations for Web Speech API
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}
