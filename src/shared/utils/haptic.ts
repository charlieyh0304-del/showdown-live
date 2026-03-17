export function vibrate(pattern: number | number[]) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

export const hapticPatterns = {
  scoreUp: 50,
  scoreDown: [30, 30, 30] as number[],
  setComplete: [100, 50, 100, 50, 200] as number[],
  matchComplete: [200, 100, 200, 100, 400] as number[],
  fault: [50, 30, 50] as number[],
  error: [100, 50, 100] as number[],
};
