/**
 * PIN 검증 순수 로직
 *
 * 저장 형식 2가지 호환:
 *  - 레거시: SHA-256 hex (64자)
 *  - 신규:   PBKDF2 "salt:hash" (salt와 hash는 hex)
 *
 * 이 파일은 외부 의존성(Firebase 등) 없이 crypto만 사용 → 단위 테스트 용이.
 */
import * as crypto from "crypto";

export function hashPinSHA256Sync(pin: string): string {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

export function hashPinPBKDF2Sync(pin: string, salt: string): string {
  const key = crypto.pbkdf2Sync(pin, salt, 100000, 32, "sha256");
  return `${salt}:${key.toString("hex")}`;
}

/**
 * 단일 저장 해시 대비 PIN 검증.
 * - stored가 "salt:hash" 형식이면 PBKDF2로 검증
 * - 그 외엔 SHA-256 hex로 간주
 */
export function verifyPinAgainstStored(pin: string, stored: string): boolean {
  if (!stored) return false;
  if (stored.includes(":")) {
    const parts = stored.split(":");
    if (parts.length !== 2) return false;
    const [salt] = parts;
    const derived = hashPinPBKDF2Sync(pin, salt);
    return timingSafeEqualStr(derived, stored);
  }
  const hash = hashPinSHA256Sync(pin);
  return timingSafeEqualStr(hash, stored);
}

/**
 * admins 컬렉션(각 항목이 { pin } 해시 가짐) 안에서 PIN과 일치하는 admin id 반환.
 * 필드명은 `pin` (shared/types/index.ts Admin 타입 기준).
 * 일치 없으면 null.
 */
export function findAdminByPin(
  admins: Record<string, { pin?: string }> | null | undefined,
  pin: string,
): string | null {
  if (!admins) return null;
  for (const [id, rec] of Object.entries(admins)) {
    if (rec?.pin && verifyPinAgainstStored(pin, rec.pin)) {
      return id;
    }
  }
  return null;
}

/** 길이가 다르면 false, 같으면 timingSafeEqual (타이밍 공격 완화) */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
