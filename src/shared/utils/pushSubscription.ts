/**
 * 푸시 구독 기록 (pushSubscriptions/{tokenKey}). 개인 정보 최소화: 토큰, 익명 인증 uid(쓰기 권한 확인용),
 * 즐겨찾기 선수 ID·이름, 기기 종류, 갱신 시각만 둔다. 공개 읽기는 없다(DB 규칙 .read false, 서버만 읽는다).
 * 이름(favoriteNames)을 함께 두는 이유: 선수 ID는 대회마다 다르고(tournamentPlayers/{tid}) 대회를 넘는 고정 ID가 없어,
 * 한 대회에서 즐겨찾기한 선수를 다음 대회에서도 알리려면 이름으로 맞춰야 한다. 선수 이름은 대진표에 이미 공개된 값이다.
 */
export interface FavEntry { id: string; name: string }

export interface PushSubscriptionRecord {
  token: string;
  uid: string;
  favoriteIds: string[];
  /** 대회를 넘어 같은 선수를 찾기 위한 이름 (서버 favoriteInMatch가 ID 다음으로 맞춘다) */
  favoriteNames: string[];
  platform: string;
  updatedAt: number;
}

/** 즐겨찾기 ID 최대 개수 (DB 규칙과 같다) */
export const MAX_FAVORITE_IDS = 100;

export function tokenToKey(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
  return 'tk_' + Math.abs(hash).toString(36);
}

export function pushSubscriptionRecord(token: string, uid: string, favorites: ReadonlyArray<FavEntry>, platform: string, now: number): PushSubscriptionRecord {
  const ids = [...new Set(favorites.map(f => f.id).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, MAX_FAVORITE_IDS);
  // ID를 아직 이름으로 못 바꾼 항목(name === id)은 이름으로 쓰지 않는다
  const names = [...new Set(favorites.filter(f => typeof f.name === 'string' && f.name.trim() && f.name !== f.id).map(f => f.name.trim()).filter(n => n.length <= 200))].slice(0, MAX_FAVORITE_IDS);
  return { token, uid, favoriteIds: ids, favoriteNames: names, platform, updatedAt: now };
}
