import { useState, useCallback, useRef } from 'react';
import { auth } from '@shared/config/firebase';

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

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'showdown-b5cc7';
const FUNCTION_URL = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/chatbot`;

function getChatStorageKey(role: ChatRole, tid?: string): string {
  return `showdown_chat_${role}_${tid || 'global'}`;
}

function loadMessages(key: string): ChatMessage[] {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.warn('[Chat] 채팅 기록 로드 실패:', err);
    return [];
  }
}

function saveMessages(key: string, msgs: ChatMessage[]) {
  try {
    localStorage.setItem(key, JSON.stringify(msgs.slice(-50))); // 최근 50개만
  } catch (err) {
    console.warn('[Chat] 채팅 기록 저장 실패 (저장소 부족 가능):', err);
  }
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
      // Firebase Auth 토큰을 Authorization 헤더에 포함 (서버 사이드 역할 검증용)
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {}),
        },
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
