import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { connectionModel, describeConnection, type ConnectionInput } from '../../utils/connectionModel';

const COLOR = { connecting: '#d1d5db', live: '#4ade80', reconnecting: '#fbbf24', cached: '#fbbf24' } as const;

/**
 * 연결 상태 줄: '실시간 연결됨 (마지막 갱신 10:42)' / '연결이 끊겨 다시 연결하는 중 — 10:40 기준, 2분 전' / '저장된 데이터 (10:30 기준, 12분 전)'.
 * 문구는 매번 읽지 않고, 상태 종류가 바뀔 때만 화면낭독기에 알린다.
 */
export default function ConnectionLine(props: ConnectionInput) {
  const { t } = useTranslation();
  const model = connectionModel(props);
  const text = describeConnection(model, t);
  const [announce, setAnnounce] = useState('');
  const prevKind = useRef(model.kind);
  useEffect(() => {
    if (prevKind.current !== model.kind) {
      prevKind.current = model.kind;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAnnounce(text);
    }
  }, [model.kind, text]);
  return (
    <>
      <p style={{ fontSize: '0.875rem', color: COLOR[model.kind], fontWeight: model.stale ? 'bold' : 'normal', marginTop: '0.25rem' }}>
        <span aria-hidden="true">{model.kind === 'live' ? '● ' : '○ '}</span>{text}
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </>
  );
}
