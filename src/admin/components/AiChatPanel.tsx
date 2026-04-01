import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatbot, type ChatMessage, type ChatAction } from '../hooks/useChatbot';

// Tool name → 한글 라벨
const TOOL_LABELS: Record<string, string> = {
  list_tournaments: '대회 조회',
  get_tournament: '대회 상세',
  list_players: '선수 조회',
  list_matches: '경기 조회',
  list_courts: '코트 조회',
  list_referees: '심판 조회',
  get_schedule: '스케줄 조회',
  create_tournament: '대회 생성',
  update_tournament: '대회 수정',
  add_players_bulk: '선수 추가',
  delete_player: '선수 삭제',
  add_match: '경기 추가',
  update_match: '경기 수정',
  delete_match: '경기 삭제',
  generate_round_robin: '대진 생성',
  generate_schedule: '스케줄 생성',
  shift_schedule: '스케줄 이동',
  move_matches_to_court: '코트 이동',
  add_court: '코트 추가',
  add_referee: '심판 추가',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ActionBadges({ actions }: { actions: ChatAction[] }) {
  if (!actions || actions.length === 0) return null;

  // Group by tool
  const counts = new Map<string, number>();
  actions.forEach(a => counts.set(a.tool, (counts.get(a.tool) || 0) + 1));

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {Array.from(counts.entries()).map(([tool, count]) => {
        const isWrite = !tool.startsWith('list_') && !tool.startsWith('get_');
        return (
          <span
            key={tool}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
              isWrite ? 'bg-green-900/60 text-green-300' : 'bg-gray-700/60 text-gray-400'
            }`}
          >
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
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
          isUser ? 'bg-cyan-700' : 'bg-gray-700'
        }`}
        aria-hidden="true"
      >
        {isUser ? '👤' : '🤖'}
      </div>

      {/* Content */}
      <div className={`max-w-[80%] ${isUser ? 'text-right' : 'text-left'}`}>
        <div
          className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
            isUser
              ? 'bg-cyan-800 text-white rounded-tr-sm'
              : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-sm'
          }`}
        >
          {msg.content}
        </div>
        {!isUser && msg.actions && <ActionBadges actions={msg.actions} />}
        <div className={`text-[10px] text-gray-500 mt-0.5 ${isUser ? 'text-right' : 'text-left'}`}>
          {formatTime(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

export default function AiChatPanel() {
  useTranslation(); // i18n context
  const { id: tournamentId } = useParams<{ id: string }>();
  const { messages, isLoading, elapsedSec, sendMessage, clearChat } = useChatbot(tournamentId);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  // Focus input after sending (fix: focus restoration)
  useEffect(() => {
    if (!isLoading && isOpen) {
      // Delay to ensure DOM is ready after state update
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isLoading, isOpen]);

  // Keyboard shortcut: Ctrl+K / Cmd+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => {
          if (!prev) setTimeout(() => inputRef.current?.focus(), 100);
          return !prev;
        });
      }
      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text);
    // Keep focus on input
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Elapsed time display
  const elapsedDisplay = elapsedSec > 0
    ? elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)}분 ${elapsedSec % 60}초`
      : `${elapsedSec}초`
    : '';

  if (!isOpen) {
    return (
      <button
        onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 100); }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110"
        aria-label="AI 어시스턴트 (Ctrl+K)"
        title="AI 어시스턴트 (Ctrl+K)"
        style={{ minWidth: '56px', minHeight: '56px' }}
      >
        💬
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-0 right-0 sm:bottom-4 sm:right-4 z-50 flex flex-col bg-gray-900 border border-gray-700 sm:rounded-xl shadow-2xl"
      style={{ width: 'min(420px, 100vw)', height: 'min(600px, 100vh)' }}
      role="dialog"
      aria-modal="false"
      aria-label="AI 어시스턴트"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-900/95">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-bold text-cyan-400">AI 어시스턴트</h2>
          <kbd className="hidden sm:inline-block text-[10px] text-gray-500 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5">Ctrl+K</kbd>
        </div>
        <div className="flex gap-1">
          <button onClick={clearChat} className="text-gray-400 hover:text-white p-2" aria-label="대화 초기화" title="대화 초기화" style={{ minWidth: '44px', minHeight: '44px' }}>
            🗑️
          </button>
          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white p-2 text-lg" aria-label="닫기 (Esc)" title="닫기 (Esc)" style={{ minWidth: '44px', minHeight: '44px' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-4" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">🤖</div>
            <p className="text-gray-400 text-sm mb-4">대회 운영에 관해 무엇이든 물어보세요</p>
            <div className="space-y-2">
              {[
                '현재 대회 목록 보여줘',
                '오후 경기 30분씩 뒤로 밀어줘',
                '코트 1번 경기를 코트 2번으로 옮겨',
              ].map((example) => (
                <button
                  key={example}
                  className="block w-full text-left text-xs text-gray-500 hover:text-cyan-400 bg-gray-800/50 hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                  onClick={() => { setInput(example); inputRef.current?.focus(); }}
                >
                  💡 "{example}"
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {isLoading && (
          <div className="flex gap-2">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm" aria-hidden="true">🤖</div>
            <div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl rounded-tl-sm px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0s' }} />
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
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-700 px-3 py-3 flex-shrink-0 bg-gray-900/95">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (Shift+Enter 줄바꿈)"
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30"
            rows={1}
            disabled={isLoading}
            aria-label="메시지 입력"
            style={{ minHeight: '44px', maxHeight: '88px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="btn btn-primary px-4 text-sm flex-shrink-0 disabled:opacity-40"
            aria-label="전송"
            style={{ minHeight: '44px' }}
          >
            {isLoading ? '⏳' : '전송'}
          </button>
        </div>
      </div>
    </div>
  );
}
