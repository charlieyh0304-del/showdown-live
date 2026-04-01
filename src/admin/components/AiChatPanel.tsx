import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useChatbot } from '../hooks/useChatbot';

export default function AiChatPanel() {
  const { t } = useTranslation();
  const { id: tournamentId } = useParams<{ id: string }>();
  const { messages, isLoading, sendMessage, clearChat } = useChatbot(tournamentId);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage(text);
  }, [input, isLoading, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110"
        aria-label={t('admin.chatbot.openButton', { defaultValue: 'AI 어시스턴트 열기' })}
        style={{ minWidth: '56px', minHeight: '56px' }}
      >
        💬
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col bg-gray-900 border border-gray-700 rounded-xl shadow-2xl"
      style={{ width: 'min(400px, calc(100vw - 2rem))', height: 'min(560px, calc(100vh - 6rem))' }}
      role="dialog"
      aria-modal="false"
      aria-label={t('admin.chatbot.title', { defaultValue: 'AI 어시스턴트' })}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <h2 className="text-sm font-bold text-cyan-400">
          🤖 {t('admin.chatbot.title', { defaultValue: 'AI 어시스턴트' })}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={clearChat}
            className="text-gray-400 hover:text-white text-xs px-2 py-1"
            aria-label={t('admin.chatbot.clearChat', { defaultValue: '대화 초기화' })}
          >
            🗑️
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="text-gray-400 hover:text-white text-lg px-1"
            aria-label={t('common.close', { defaultValue: '닫기' })}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            <p className="mb-2">💡 {t('admin.chatbot.placeholder', { defaultValue: '대회 운영에 관해 무엇이든 물어보세요' })}</p>
            <div className="space-y-1 text-xs text-gray-600">
              <p>"32명 개인전 대회 만들어줘"</p>
              <p>"오후 경기 30분씩 뒤로 밀어줘"</p>
              <p>"코트 1번 경기를 코트 2번으로 옮겨"</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-cyan-800 text-white'
                  : 'bg-gray-800 text-gray-200 border border-gray-700'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm">
              <span className="animate-pulse text-cyan-400">●</span>
              <span className="animate-pulse text-cyan-400" style={{ animationDelay: '0.2s' }}> ●</span>
              <span className="animate-pulse text-cyan-400" style={{ animationDelay: '0.4s' }}> ●</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-700 px-3 py-3 flex-shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('admin.chatbot.inputPlaceholder', { defaultValue: '메시지를 입력하세요...' })}
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-cyan-500"
            rows={1}
            disabled={isLoading}
            aria-label={t('admin.chatbot.inputLabel', { defaultValue: '메시지 입력' })}
            style={{ minHeight: '44px', maxHeight: '88px' }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="btn btn-primary px-4 text-sm flex-shrink-0"
            aria-label={t('admin.chatbot.sendButton', { defaultValue: '전송' })}
            style={{ minHeight: '44px' }}
          >
            {t('admin.chatbot.sendButton', { defaultValue: '전송' })}
          </button>
        </div>
      </div>
    </div>
  );
}
