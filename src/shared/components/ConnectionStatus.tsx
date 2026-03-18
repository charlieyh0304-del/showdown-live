import { useConnection } from '../hooks/useConnection';

export default function ConnectionStatus() {
  const isOnline = useConnection();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-red-700 text-white text-center py-2 z-50 text-lg font-bold" role="alert">
      오프라인 - 인터넷 연결을 확인해주세요
    </div>
  );
}
