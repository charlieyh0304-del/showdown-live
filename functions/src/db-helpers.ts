/**
 * DB 헬퍼 — chatbot-tools.ts에서 자주 쓰이는 공통 패턴
 * 향후 모듈 분리 시 이 파일을 import해서 사용
 */
import * as admin from "firebase-admin";
import * as crypto from "crypto";

export const db = admin.database();

// ===== PIN 해시 =====
export async function hashPinSHA256(pin: string): Promise<string> {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

export async function hashPinPBKDF2(pin: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, salt, 100000, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

// ===== 날짜 헬퍼 =====
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ===== 안전한 데이터 추출 =====
export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && !isNaN(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// ===== Firebase snapshot 안전 변환 =====
export async function loadOptional<T>(path: string): Promise<T | null> {
  const snap = await db.ref(path).once("value");
  return snap.exists() ? (snap.val() as T) : null;
}

export async function loadRequired<T>(path: string, errorMsg = "데이터를 찾을 수 없습니다."): Promise<T> {
  const snap = await db.ref(path).once("value");
  if (!snap.exists()) throw new Error(errorMsg);
  return snap.val() as T;
}

// ===== 매치 객체 헬퍼 =====
export interface MatchSummary {
  id: string;
  status: string;
  stageId?: string;
  groupId?: string;
  isBye?: boolean;
}

export function getStageCategory(m: { stageId?: unknown; bracketRound?: unknown }): "qualifying" | "finals" | "ranking" | "unknown" {
  const sid = asString(m.stageId);
  const br = asString(m.bracketRound);
  if (sid.includes("class") || sid.includes("5to8") || sid.includes("9to16") || sid.includes("3rd")) return "ranking";
  if (sid.includes("finals")) return "finals";
  if (sid.includes("qualifying") || br === "") return "qualifying";
  return "unknown";
}

export function getMatchPlayers(m: Record<string, unknown>): { p1Id: string; p2Id: string; p1Name: string; p2Name: string } {
  return {
    p1Id: asString(m.player1Id || m.team1Id),
    p2Id: asString(m.player2Id || m.team2Id),
    p1Name: asString(m.player1Name || m.team1Name),
    p2Name: asString(m.player2Name || m.team2Name),
  };
}

export function getMatchWinnerLoser(m: Record<string, unknown>): { winnerId: string; winnerName: string; loserId: string; loserName: string } | null {
  const wId = asString(m.winnerId);
  if (!wId) return null;
  const { p1Id, p2Id, p1Name, p2Name } = getMatchPlayers(m);
  if (wId === p1Id) {
    return { winnerId: p1Id, winnerName: p1Name, loserId: p2Id, loserName: p2Name };
  }
  return { winnerId: p2Id, winnerName: p2Name, loserId: p1Id, loserName: p1Name };
}
