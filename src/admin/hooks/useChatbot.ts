import { useState, useCallback, useRef } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatAction {
  tool: string;
  input: Record<string, unknown>;
  result: string;
}

const FUNCTION_URL = 'https://us-central1-showdown-b5cc7.cloudfunctions.net/chatbot';

export function useChatbot(tournamentId?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastActions, setLastActions] = useState<ChatAction[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);
    setError(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, tournamentId }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = { role: 'assistant', content: data.reply };
      setMessages(prev => [...prev, assistantMsg]);
      setLastActions(data.actions || []);
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      const msg = (err as Error).message || 'AI 요청 실패';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ 오류: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, tournamentId]);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setLastActions([]);
  }, []);

  return { messages, isLoading, error, lastActions, sendMessage, clearChat };
}
