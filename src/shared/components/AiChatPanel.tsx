import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatbot, type ChatRole, type ChatMessage, type ChatAction } from '../hooks/useChatbot';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'code', 'pre', 'p', 'span', 'div', 'h2', 'h3', 'h4'],
  ALLOWED_ATTR: ['class'],
};

type TFunc = (key: string) => string;

function getToolLabels(t: TFunc): Record<string, string> {
  return {
    list_tournaments: t('common.aiChat.tools.listTournaments'), get_tournament: t('common.aiChat.tools.getTournament'), list_players: t('common.aiChat.tools.listPlayers'),
    list_matches: t('common.aiChat.tools.listMatches'), list_courts: t('common.aiChat.tools.listCourts'), list_referees: t('common.aiChat.tools.listReferees'),
    get_schedule: t('common.aiChat.tools.getSchedule'), create_tournament: t('common.aiChat.tools.createTournament'), update_tournament: t('common.aiChat.tools.updateTournament'),
    setup_full_tournament: t('common.aiChat.tools.setupFullTournament'), delete_tournament: t('common.aiChat.tools.deleteTournament'),
    add_players_bulk: t('common.aiChat.tools.addPlayersBulk'), delete_player: t('common.aiChat.tools.deletePlayer'),
    add_match: t('common.aiChat.tools.addMatch'), update_match: t('common.aiChat.tools.updateMatch'), delete_match: t('common.aiChat.tools.deleteMatch'),
    generate_round_robin: t('common.aiChat.tools.generateRoundRobin'), generate_finals: t('common.aiChat.tools.generateFinals'),
    simulate_matches: t('common.aiChat.tools.simulateMatches'), generate_schedule: t('common.aiChat.tools.generateSchedule'),
    shift_schedule: t('common.aiChat.tools.shiftSchedule'), move_matches_to_court: t('common.aiChat.tools.moveMatchesToCourt'),
    add_court: t('common.aiChat.tools.addCourt'), add_referee: t('common.aiChat.tools.addReferee'),
  };
}

function getRoleConfig(t: TFunc): Record<ChatRole, { icon: string; title: string; placeholder: string; examples: string[] }> {
  return {
    admin: {
      icon: '🤖', title: t('common.aiChat.roles.admin.title'),
      placeholder: t('common.aiChat.roles.admin.placeholder'),
      examples: [t('common.aiChat.roles.admin.example1'), t('common.aiChat.roles.admin.example2'), t('common.aiChat.roles.admin.example3')],
    },
    referee: {
      icon: '🏅', title: t('common.aiChat.roles.referee.title'),
      placeholder: t('common.aiChat.roles.referee.placeholder'),
      examples: [t('common.aiChat.roles.referee.example1'), t('common.aiChat.roles.referee.example2'), t('common.aiChat.roles.referee.example3')],
    },
    spectator: {
      icon: '📢', title: t('common.aiChat.roles.spectator.title'),
      placeholder: t('common.aiChat.roles.spectator.placeholder'),
      examples: [t('common.aiChat.roles.spectator.example1'), t('common.aiChat.roles.spectator.example2'), t('common.aiChat.roles.spectator.example3')],
    },
  };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ActionBadges({ actions, toolLabels }: { actions: ChatAction[]; toolLabels: Record<string, string> }) {
  if (!actions || actions.length === 0) return null;
  const counts = new Map<string, number>();
  actions.forEach(a => counts.set(a.tool, (counts.get(a.tool) || 0) + 1));
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {Array.from(counts.entries()).map(([tool, count]) => {
        const isWrite = !tool.startsWith('list_') && !tool.startsWith('get_');
        return (
          <span key={tool} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${isWrite ? 'bg-green-900/60 text-green-300' : 'bg-gray-700/60 text-gray-400'}`}>
            {isWrite ? '✓' : '🔍'} {toolLabels[tool] || tool}{count > 1 ? ` ×${count}` : ''}
          </span>
        );
      })}
    </div>
  );
}

/** 간단한 마크다운 → HTML 변환 (헤딩, 목록, 굵은 글씨, 테이블) */
function simpleMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-bold text-cyan-400 mt-2 mb-1">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-bold text-cyan-300 mt-3 mb-1">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="text-lg font-bold text-cyan-200 mt-3 mb-1">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split('|').map((c: string) => c.trim());
      return '<tr>' + cells.map((c: string) => `<td class="border border-gray-600 px-2 py-1 text-xs">${c}</td>`).join('') + '</tr>';
    })
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm">$2</li>')
    .replace(/---/g, '<hr class="border-gray-600 my-2" />')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

function MessageBubble({ msg, toolLabels, purify }: { msg: ChatMessage; toolLabels: Record<string, string>; purify: typeof import('dompurify').default | null }) {
  const isUser = msg.role === 'user';
  const canSanitize = !!purify && typeof purify.sanitize === 'function';
  const sanitizedHtml = !isUser && canSanitize
    ? purify!.sanitize(simpleMarkdown(msg.content), SANITIZE_CONFIG)
    : '';
  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${isUser ? 'bg-cyan-700' : 'bg-gray-700'}`} aria-hidden="true">
        {isUser ? '👤' : '🤖'}
      </div>
      <div className={`max-w-[80%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div className={`rounded-xl px-3 py-2 text-sm ${isUser ? 'bg-cyan-800 text-white rounded-tr-sm whitespace-pre-wrap' : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-sm'}`}>
          {isUser
            ? msg.content
            : canSanitize
              ? <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
              : <div className="whitespace-pre-wrap">{msg.content}</div>
          }
        </div>
        {!isUser && msg.actions && <ActionBadges actions={msg.actions} toolLabels={toolLabels} />}
        <div className={`text-[10px] text-gray-500 mt-0.5 ${isUser ? 'text-right' : 'text-left'}`}>{formatTime(msg.timestamp)}</div>
      </div>
    </div>
  );
}

interface AiChatPanelProps {
  userRole: ChatRole;
  contextInfo?: string; // 추가 컨텍스트 (심판 이름, 대회명 등)
}

export default function AiChatPanel({ userRole, contextInfo }: AiChatPanelProps) {
  const { t } = useTranslation();
  const { id: tournamentId } = useParams<{ id: string }>();
  const { messages, isLoading, elapsedSec, sendMessage, cancelRequest, clearChat } = useChatbot(userRole, tournamentId, contextInfo);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [domPurify, setDomPurify] = useState<typeof import('dompurify').default | null>(null);
  useEffect(() => {
    if (isOpen && !domPurify && typeof window !== 'undefined') {
      import('dompurify').then(m => {
        // dompurify 3.x: ESM default export is a DOMPurify instance with .sanitize.
        // CJS interop edge cases: `m` may already BE the instance (no default wrap).
        // If window wasn't available at module eval time, the instance is a factory
        // lacking .sanitize — re-instantiate with the live window.
        const mod = m as unknown as { default?: unknown };
        let purify = (mod.default ?? m) as {
          sanitize?: (html: string, config?: unknown) => string;
          (win: Window): { sanitize?: (html: string, config?: unknown) => string };
        };
        if (typeof purify.sanitize !== 'function' && typeof purify === 'function') {
          try { purify = purify(window) as typeof purify; } catch { /* ignore */ }
        }
        if (typeof purify.sanitize === 'function') {
          setDomPurify(purify as unknown as typeof import('dompurify').default);
        }
      }).catch(() => { /* fall back to plain-text rendering */ });
    }
  }, [isOpen, domPurify]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const config = getRoleConfig(t)[userRole];
  const toolLabels = getToolLabels(t);

  useEffect(() => {
    // textarea에 포커스가 있으면 스크롤하지 않음 (스크린리더 가상커서 보호)
    if (scrollRef.current && document.activeElement !== inputRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // 응답 도착 후 포커스 복원 (isLoading true→false 전환 시만)
  const prevLoading = useRef(false);
  useEffect(() => {
    if (prevLoading.current && !isLoading && isOpen) {
      // 스크린리더 가상커서 이동 방지: setTimeout으로 지연
      setTimeout(() => {
        if (document.activeElement !== inputRef.current) {
          inputRef.current?.focus({ preventScroll: true });
        }
      }, 100);
    }
    prevLoading.current = isLoading;
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
  const [voiceEnabled, setVoiceEnabled] = useState(false); // TTS on/off
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
    // 포커스를 먼저 유지한 상태에서 입력 지우기 (DOM 변경 최소화)
    requestAnimationFrame(() => {
      setInput('');
      // 포커스가 이미 textarea에 있으면 건드리지 않음
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus({ preventScroll: true });
      }
    });
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
  const longPressTriggered = useRef(false);
  const handlePointerDown = useCallback(() => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setIsOpen(true);
      setTimeout(() => startListening(), 200);
      longPressTimer.current = null;
    }, 500);
  }, [startListening]);
  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // 짧은 탭은 onClick에서 처리 (VoiceOver 호환)
  }, []);
  const handlePointerCancel = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);
  // VoiceOver/TalkBack: click 이벤트로 열기 (더블탭)
  const handleClick = useCallback(() => {
    if (!longPressTriggered.current) openChat();
  }, [openChat]);

  // 2손가락 더블탭 → 음성 AI 바로 시작 (모든 화면에서 동작)
  const twoFingerTapRef = useRef<{ count: number; lastTime: number }>({ count: 0, lastTime: 0 });
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const now = Date.now();
      const ref = twoFingerTapRef.current;
      if (now - ref.lastTime < 400) {
        ref.count++;
      } else {
        ref.count = 1;
      }
      ref.lastTime = now;

      if (ref.count >= 2) {
        ref.count = 0;
        e.preventDefault();
        // 패널 열기 + 음성 시작
        setIsOpen(true);
        setTimeout(() => startListening(), 300);
      }
    };
    window.addEventListener('touchstart', handler, { passive: false });
    return () => window.removeEventListener('touchstart', handler);
  }, [startListening]);

  // 스크린리더 전용 바로가기 (항상 렌더링, 열림/닫힘 무관)
  const srShortcut = (
    <div className="sr-only" role="region" aria-label={t('common.aiChat.srShortcutRegion')}>
      <button
        onClick={() => { setIsOpen(true); setTimeout(() => startListening(), 300); }}
        aria-label={t('common.aiChat.startVoiceAriaLabel', { title: config.title })}
      >
        {t('common.aiChat.startVoiceButton')}
      </button>
      <button
        onClick={openChat}
        aria-label={t('common.aiChat.openTextAriaLabel', { title: config.title })}
        aria-keyshortcuts="Control+K"
      >
        {t('common.aiChat.openTextButton')}
      </button>
    </div>
  );

  if (!isOpen) {
    return (
      <>
      {srShortcut}
      <div aria-live="polite" className="sr-only">
        {t('common.aiChat.closed', { title: config.title })}
      </div>
      <button
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110"
        aria-hidden="true"
        tabIndex={-1}
        title={t('common.aiChat.longPressHint', { title: config.title })}
        style={{ minWidth: '56px', minHeight: '56px' }}
      >
        {config.icon === '🤖' ? '💬' : config.icon}
      </button>
      </>
    );
  }

  return (
    <>
    {srShortcut}
    <div className="fixed bottom-0 right-0 sm:bottom-4 sm:right-4 z-50 flex flex-col bg-gray-900 border border-gray-700 sm:rounded-xl shadow-2xl"
      style={{ width: 'min(420px, 100vw)', height: 'min(600px, 100vh)' }}
      role="dialog" aria-modal="true" aria-label={config.title}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-900/95">
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.icon}</span>
          <h2 className="text-sm font-bold text-cyan-400">{config.title}</h2>
          <kbd className="hidden sm:inline-block text-[10px] text-gray-500 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5">Ctrl+K</kbd>
        </div>
        <div className="flex gap-1">
          <button onClick={clearChat} className="text-gray-400 hover:text-white p-2" aria-label={t('common.aiChat.clearChat')} style={{ minWidth: '44px', minHeight: '44px' }}>🗑️</button>
          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white p-2 text-lg" aria-label={t('common.aiChat.closeEsc')} style={{ minWidth: '44px', minHeight: '44px' }}>✕</button>
        </div>
      </div>

      {/* 스크린리더: 마지막 AI 응답만 알림 (가상커서 이동 없이) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {messages.length > 0 && messages[messages.length - 1].role === 'assistant' && !isLoading
          ? messages[messages.length - 1].content.slice(0, 200)
          : isLoading ? t('common.aiChat.processing') : ''}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4" style={{ minHeight: 0 }} role="log" aria-live="off">
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
        {messages.map((msg, i) => <MessageBubble key={i} msg={msg} toolLabels={toolLabels} purify={domPurify} />)}
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
                  <span className="text-xs text-gray-500">{t('common.aiChat.processing')}</span>
                </div>
                {elapsedDisplay && (
                  <div className="text-[10px] text-gray-500 mt-1.5 flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    {t('common.aiChat.elapsed', { time: elapsedDisplay })}
                  </div>
                )}
                <button onClick={cancelRequest} className="mt-2 text-xs text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/50 rounded px-2 py-1" style={{ minHeight: '32px' }} aria-label={t('common.aiChat.cancelRequest')}>
                  ⛔ {t('common.aiChat.cancelButton')}
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
              aria-label={isListening ? t('common.aiChat.stopVoice') : t('common.aiChat.startVoice')}
              title={isListening ? t('common.aiChat.voiceInputActive') : t('common.aiChat.voiceInput')}
              disabled={isLoading}
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              {isListening ? '⏹' : '🎤'}
            </button>
          )}
          <textarea id="ai-chat-input" ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={isListening ? t('common.aiChat.listening') : t('common.aiChat.messagePlaceholder')}
            className={`flex-1 bg-gray-800 border rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:ring-1 ${isListening ? 'border-red-500 focus:border-red-500 focus:ring-red-500/30' : 'border-gray-600 focus:border-cyan-500 focus:ring-cyan-500/30'}`}
            rows={1} disabled={isLoading} aria-label={t('common.aiChat.messageInput')} style={{ minHeight: '44px', maxHeight: '88px' }}
          />
          {isLoading ? (
            <button onClick={cancelRequest} className="btn btn-danger px-3 text-sm flex-shrink-0" aria-label={t('common.aiChat.cancelButton')} style={{ minHeight: '44px' }}>⛔</button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()} className="btn btn-primary px-3 text-sm flex-shrink-0 disabled:opacity-40" aria-label={t('common.aiChat.send')} style={{ minHeight: '44px' }}>{t('common.aiChat.send')}</button>
          )}
        </div>
        <div className="flex justify-end mt-1">
          <button
            onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) window.speechSynthesis?.cancel(); }}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
            aria-label={voiceEnabled ? t('common.aiChat.voiceResponseOnAriaLabel') : t('common.aiChat.voiceResponseOffAriaLabel')}
            aria-pressed={voiceEnabled}
          >
            {voiceEnabled ? t('common.aiChat.voiceResponseOn') : t('common.aiChat.voiceResponseOff')}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
