// PIN을 SHA-256 해시로 변환
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// PIN 검증 (SHA-256 및 PBKDF2 해시 모두 지원)
export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  // PBKDF2 해시인 경우 (salt:hash 형식)
  if (hashedPin.includes(':')) {
    const [salt, storedHash] = hashedPin.split(':');
    const hash = await hashPinWithSalt(pin, salt);
    return hash === `${salt}:${storedHash}`;
  }
  // 레거시 SHA-256 해시
  const hash = await hashPin(pin);
  return hash === hashedPin;
}

// 솔트 생성
export function generateSalt(): string {
  const saltArray = new Uint8Array(16);
  crypto.getRandomValues(saltArray);
  return Array.from(saltArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2를 사용한 솔트 기반 PIN 해시
export async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${salt}:${hashHex}`;
}

// 레이트 리미터
export interface RateLimiter {
  canAttempt: () => boolean;
  recordFailure: () => void;
  recordSuccess: () => void;
  remainingLockout: () => number;
}

export function createRateLimiter(maxAttempts: number, lockoutMs: number): RateLimiter {
  let failures = 0;
  let lockoutUntil = 0;

  return {
    canAttempt: () => {
      if (lockoutUntil > 0 && Date.now() < lockoutUntil) {
        return false;
      }
      if (lockoutUntil > 0 && Date.now() >= lockoutUntil) {
        // 잠금 해제 시 실패 횟수 초기화
        failures = 0;
        lockoutUntil = 0;
      }
      return true;
    },
    recordFailure: () => {
      failures++;
      if (failures >= maxAttempts) {
        lockoutUntil = Date.now() + lockoutMs;
      }
    },
    recordSuccess: () => {
      failures = 0;
      lockoutUntil = 0;
    },
    remainingLockout: () => {
      if (lockoutUntil <= 0) return 0;
      const remaining = lockoutUntil - Date.now();
      return remaining > 0 ? remaining : 0;
    },
  };
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
