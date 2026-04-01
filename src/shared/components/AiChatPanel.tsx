import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useChatbot, type ChatRole, type ChatMessage, type ChatAction } from '../hooks/useChatbot';

const TOOL_LABELS: Record<string, string> = {
  list_tournaments: '대회 조회', get_tournament: '대회 상세', list_players: '선수 조회',
  list_matches: '경기 조회', list_courts: '코트 조회', list_referees: '심판 조회',
  get_schedule: '스케줄 조회', create_tournament: '대회 생성', update_tournament: '대회 수정',
  setup_full_tournament: '대회 구성', delete_tournament: '대회 삭제',
  add_players_bulk: '선수 추가', delete_player: '선수 삭제',
  add_match: '경기 추가', update_match: '경기 수정', delete_match: '경기 삭제',
  generate_round_robin: '대진 생성', generate_finals: '본선 생성',
  simulate_matches: '시뮬레이션', generate_schedule: '스케줄 생성',
  shift_schedule: '스케줄 이동', move_matches_to_court: '코트 이동',
  add_court: '코트 추가', add_referee: '심판 추가',
};

const ROLE_CONFIG: Record<ChatRole, { icon: string; title: string; placeholder: string; examples: string[] }> = {
  admin: {
    icon: '🤖', title: 'AI 어시스턴트',
    placeholder: '대회 운영에 관해 무엇이든 물어보세요',
    examples: ['대회 생성해줘', '오후 경기 30분 뒤로 밀어줘', '예선 시뮬레이션 돌려줘'],
  },
  referee: {
    icon: '🏅', title: 'AI 심판 도우미',
    placeholder: '경기 정보를 물어보세요',
    examples: ['내 다음 배정 경기는?', '현재 진행 중인 경기 알려줘', '오늘 남은 경기 몇 개야?'],
  },
  spectator: {
    icon: '📢', title: 'AI 관람 도우미',
    placeholder: '선수나 경기 정보를 물어보세요',
    examples: ['김민태 다음 경기 언제야?', 'A조 순위 알려줘', '오늘 결승 몇 시야?'],
  },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ActionBadges({ actions }: { actions: ChatAction[] }) {
  if (!actions || actions.length === 0) return null;
  const counts = new Map<string, number>();
  actions.forEach(a => counts.set(a.tool, (counts.get(a.tool) || 0) + 1));
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {Array.from(counts.entries()).map(([tool, count]) => {
        const isWrite = !tool.startsWith('list_') && !tool.startsWith('get_');
        return (
          <span key={tool} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${isWrite ? 'bg-green-900/60 text-green-300' : 'bg-gray-700/60 text-gray-400'}`}>
            {isWrite ? '✓' : '🔍'} {TOOL_LABELS[tool] || tool}{count > 1 ? ` ×${count}` : ''}
          </span>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${isUser ? 'bg-cyan-700' : 'bg-gray-700'}`} aria-hidden="true">
        {isUser ? '👤' : '🤖'}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${isUser ? 'bg-cyan-800 text-white rounded-tr-sm' : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-sm'}`}>
          {msg.content}
        </div>
        {!isUser && msg.actions && <ActionBadges actions={msg.actions} />}
        <div className={`text-[10px] text-gray-500 mt-0.5 ${isUser ? 'text-right' : 'text-left'}`}>{formatTime(msg.timestamp)}</div>
      </div>
    </div>
  );
}

interface AiChatPanelProps {
  userRole: ChatRole;
}

export default function AiChatPanel({ userRole }: AiChatPanelProps) {
  const { id: tournamentId } = useParams<{ id: string }>();
  const { messages, isLoading, elapsedSec, sendMessage, cancelRequest, clearChat } = useChatbot(userRole, tournamentId);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const config = ROLE_CONFIG[userRole];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  useEffect(() => {
    if (!isLoading && isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isLoading, isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => { if (!prev) setTimeout(() => inputRef.current?.focus(), 100); return !prev; });
      }
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  // 우측 가장자리 스와이프 → 패널 열기/닫기
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    const EDGE_ZONE = 30; // 화면 우측 30px 영역에서 시작해야 함
    const MIN_SWIPE = 60;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > Math.abs(dx)) return; // 세로 스크롤이면 무시

      // 닫힌 상태: 우측 가장자리에서 왼쪽 스와이프 → 열기
      if (!isOpen && startX > window.innerWidth - EDGE_ZONE && dx < -MIN_SWIPE) {
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      // 열린 상태: 오른쪽 스와이프 → 닫기
      if (isOpen && dx > MIN_SWIPE) {
        setIsOpen(false);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isOpen]);

  // 음성 입력 (Speech Recognition)
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true); // TTS on/off
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const speechSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!speechSupported || isLoading) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
      setInput(transcript);
      if (event.results[event.results.length - 1].isFinal) {
        setIsListening(false);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [speechSupported, isLoading]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, stopListening, startListening]);

  // 음성 출력 (TTS) — AI 응답 자동 읽기
  useEffect(() => {
    if (!voiceEnabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant' || last.content.startsWith('⚠️') || last.content.startsWith('⛔')) return;

    const text = last.content.slice(0, 500); // 너무 긴 응답은 잘라서 읽기
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ko-KR';
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  }, [messages, voiceEnabled]);

  // 음성 입력 완료 후 자동 전송
  useEffect(() => {
    if (!isListening && input.trim() && recognitionRef.current) {
      const timer = setTimeout(() => {
        if (input.trim()) {
          sendMessage(input.trim());
          setInput('');
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isListening]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage(text);
    setInput('');
    requestAnimationFrame(() => inputRef.current?.focus());
    setTimeout(() => inputRef.current?.focus(), 50);
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const elapsedDisplay = elapsedSec > 0 ? (elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}분 ${elapsedSec % 60}초` : `${elapsedSec}초`) : '';

  // 스크린리더용 aria-live 안내
  const openChat = useCallback(() => {
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Long press → 패널 열기 + 음성 입력 바로 시작
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePointerDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setIsOpen(true);
      setTimeout(() => startListening(), 200);
      longPressTimer.current = null;
    }, 500);
  }, [startListening]);
  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      openChat(); // 짧은 탭 → 일반 열기
    }
  }, [openChat]);
  const handlePointerCancel = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);

  if (!isOpen) {
    return (
      <>
      <div aria-live="polite" className="sr-only">
        {config.title} 닫힘. 버튼을 눌러 열 수 있습니다. 길게 누르면 음성 입력이 시작됩니다.
      </div>
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110"
        aria-label={`${config.title} — 탭: 열기, 길게 누르기: 음성 입력`}
        title={`${config.title} — 길게 누르면 음성 입력`}
        style={{ minWidth: '56px', minHeight: '56px' }}
      >
        {config.icon === '🤖' ? '💬' : config.icon}
      </button>
      </>
    );
  }

  return (
    <>
    <div aria-live="polite" className="sr-only">{config.title} 열림. 메시지를 입력할 수 있습니다. 오른쪽으로 스와이프하거나 Esc 키로 닫을 수 있습니다.</div>
    <div className="fixed bottom-0 right-0 sm:bottom-4 sm:right-4 z-50 flex flex-col bg-gray-900 border border-gray-700 sm:rounded-xl shadow-2xl"
      style={{ width: 'min(420px, 100vw)', height: 'min(600px, 100vh)' }}
      role="dialog" aria-modal="false" aria-label={config.title}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-900/95">
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.icon}</span>
          <h2 className="text-sm font-bold text-cyan-400">{config.title}</h2>
          <kbd className="hidden sm:inline-block text-[10px] text-gray-500 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5">Ctrl+K</kbd>
        </div>
        <div className="flex gap-1">
          <button onClick={clearChat} className="text-gray-400 hover:text-white p-2" aria-label="대화 초기화" style={{ minWidth: '44px', minHeight: '44px' }}>🗑️</button>
          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white p-2 text-lg" aria-label="닫기 (Esc)" style={{ minWidth: '44px', minHeight: '44px' }}>✕</button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">{config.icon}</div>
            <p className="text-gray-400 text-sm mb-4">{config.placeholder}</p>
            <div className="space-y-2">
              {config.examples.map(ex => (
                <button key={ex} className="block w-full text-left text-xs text-gray-500 hover:text-cyan-400 bg-gray-800/50 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                  onClick={() => { setInput(ex); inputRef.current?.focus(); }}>
                  💡 "{ex}"
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
        {isLoading && (
          <div className="flex gap-2">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm" aria-hidden="true">🤖</div>
            <div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" />
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0.15s' }} />
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0.3s' }} />
                  </div>
                  <span className="text-xs text-gray-500">작업 중...</span>
                </div>
                {elapsedDisplay && (
                  <div className="text-[10px] text-gray-500 mt-1.5 flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    {elapsedDisplay} 경과
                  </div>
                )}
                <button onClick={cancelRequest} className="mt-2 text-xs text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/50 rounded px-2 py-1" style={{ minHeight: '32px' }} aria-label="요청 취소">
                  ⛔ 취소
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-700 px-3 py-3 flex-shrink-0 bg-gray-900/95">
        <div className="flex gap-2 items-end">
          {speechSupported && (
            <button
              onClick={toggleListening}
              className={`flex-shrink-0 rounded-full w-10 h-10 flex items-center justify-center text-lg transition-colors ${isListening ? 'bg-red-600 animate-pulse text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
              aria-label={isListening ? '음성 입력 중지' : '음성 입력 시작'}
              title={isListening ? '음성 입력 중...' : '음성 입력'}
              disabled={isLoading}
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              {isListening ? '⏹' : '🎤'}
            </button>
          )}
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isListening ? '듣고 있습니다...' : '메시지를 입력하세요...'}
            className={`flex-1 bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-1 ${isListening ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30' : 'border-gray-600 focus:border-cyan-500 focus:ring-cyan-500/30'}`}
            rows={1} disabled={isLoading} aria-label="메시지 입력" style={{ minHeight: '44px', maxHeight: '88px' }}
          />
          {isLoading ? (
            <button onClick={cancelRequest} className="btn btn-danger px-3 text-sm flex-shrink-0" aria-label="취소" style={{ minHeight: '44px' }}>⛔</button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()} className="btn btn-primary px-3 text-sm flex-shrink-0 disabled:opacity-40" aria-label="전송" style={{ minHeight: '44px' }}>전송</button>
          )}
        </div>
        <div className="flex justify-end mt-1">
          <button
            onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) window.speechSynthesis?.cancel(); }}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
            aria-label={voiceEnabled ? '음성 응답 끄기' : '음성 응답 켜기'}
            aria-pressed={voiceEnabled}
          >
            {voiceEnabled ? '🔊 음성 응답 ON' : '🔇 음성 응답 OFF'}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
