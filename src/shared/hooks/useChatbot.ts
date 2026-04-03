import { useState, useCallback, useRef } from 'react';

export type ChatRole = 'admin' | 'referee' | 'spectator';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  actions?: ChatAction[];
}

export interface ChatAction {
  tool: string;
  input: Record<string, unknown>;
  result: string;
}

const FUNCTION_URL = 'https://us-central1-showdown-b5cc7.cloudfunctions.net/chatbot';

function getChatStorageKey(role: ChatRole, tid?: string): string {
  return `showdown_chat_${role}_${tid || 'global'}`;
}

function loadMessages(key: string): ChatMessage[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveMessages(key: string, msgs: ChatMessage[]) {
  try {
    localStorage.setItem(key, JSON.stringify(msgs.slice(-50))); // 최근 50개만
  } catch { /* storage full */ }
}

export function useChatbot(userRole: ChatRole, tournamentId?: string, contextInfo?: string) {
  const storageKey = getChatStorageKey(userRole, tournamentId);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(storageKey));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
    const updatedMessages = [...messagesRef.current, userMsg];
    setMessages(updatedMessages);
    saveMessages(storageKey, updatedMessages);
    setIsLoading(true);
    setError(null);
    setElapsedSec(0);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000);
    abortRef.current = new AbortController();

    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          tournamentId,
          userRole,
          contextInfo,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setMessages(prev => {
        const updated = [...prev, {
          role: 'assistant' as const, content: data.reply as string, timestamp: Date.now(), actions: data.actions || [],
        }];
        saveMessages(storageKey, updated);
        return updated;
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      const msg = (err as Error).message || 'AI 요청 실패';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ 오류: ${msg}`, timestamp: Date.now() }]);
    } finally {
      setIsLoading(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, [tournamentId, userRole, contextInfo, storageKey]);

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsLoading(false);
    setElapsedSec(0);
    setMessages(prev => [...prev, { role: 'assistant', content: '⛔ 요청이 취소되었습니다.', timestamp: Date.now() }]);
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setMessages([]);
    setError(null);
    setElapsedSec(0);
    saveMessages(storageKey, []);
  }, [storageKey]);

  return { messages, isLoading, error, elapsedSec, sendMessage, cancelRequest, clearChat };
}
