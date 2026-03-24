export default function LoadingSpinner({ message = '로딩 중...' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
      <span className="text-2xl text-gray-400 animate-pulse" aria-label={message}>{message}</span>
      <span className="sr-only">{message}</span>
    </div>
  );
}
