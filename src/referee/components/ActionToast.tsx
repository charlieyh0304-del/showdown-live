import { useEffect, useState, useRef } from 'react';

interface ActionToastProps {
  message: string;
}

export default function ActionToast({ message }: ActionToastProps) {
  const [visible, setVisible] = useState(false);
  const [displayMsg, setDisplayMsg] = useState('');
  const counterRef = useRef(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!message) return;
    counterRef.current++;
    setKey(counterRef.current);
    setDisplayMsg(message);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  if (!visible || !displayMsg) return null;

  return (
    <div
      key={key}
      className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-600 text-white px-5 py-3 rounded-xl shadow-lg text-center max-w-sm animate-toast"
    >
      <style>{`
        @keyframes toastFadeInOut {
          0% { opacity: 0; transform: translate(-50%, -10px); }
          10% { opacity: 1; transform: translate(-50%, 0); }
          80% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -10px); }
        }
        .animate-toast { animation: toastFadeInOut 2.5s ease-in-out forwards; }
      `}</style>
      <div className="text-sm font-semibold">{displayMsg}</div>
    </div>
  );
}
