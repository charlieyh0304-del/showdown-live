// PIN을 SHA-256 해시로 변환
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// PIN 검증
export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  const hash = await hashPin(pin);
  return hash === hashedPin;
}

// 관람자 디바이스 ID 생성/조회 (localStorage 기반)
export function getDeviceId(): string {
  const key = 'showdown_device_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
