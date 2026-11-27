import { describe, it, expect } from "vitest";
import { favoriteInMatch, favoriteSideInfo, matchParticipants, selectSubscriptions, stringList } from "./push-targets";

const match = {
  player1Id: "p1", player1Name: "김철수", player2Id: "p2", player2Name: "이영희",
};
const team = {
  team1Id: "t1", team1Name: "서울", team2Id: "t2", team2Name: "부산",
  team1: { memberIds: { 0: "m1", 1: "m2" } }, team2: { memberIds: ["m3"] },
};

describe("push targets", () => {
  it("reads RTDB arrays stored as objects", () => {
    expect(stringList({ 0: "a", 1: "b" })).toEqual(["a", "b"]);
    expect(stringList(undefined)).toEqual([]);
  });

  it("matches subscriptions by favorite player id, including team members", () => {
    const subs = [
      { token: "A", favoriteIds: ["p2"] },
      { token: "B", favoriteIds: ["zz"] },
      { token: "C", favoriteIds: { 0: "m3" } },
      { token: "", favoriteIds: ["p1"] },
    ];
    expect(selectSubscriptions(subs, matchParticipants(match)).map((s) => s.token)).toEqual(["A"]);
    expect(selectSubscriptions(subs, matchParticipants(team)).map((s) => s.token)).toEqual(["C"]);
  });

  it("subscriptions without favorites (empty list not stored) match nothing", () => {
    expect(selectSubscriptions([{ token: "A" }], matchParticipants(match))).toEqual([]);
  });

  it("matches by favoriteNames so a favourite from another tournament (different player id) still gets alerts", () => {
    expect(favoriteInMatch({ token: "A", favoriteNames: ["이영희"] }, matchParticipants(match))).toBe("이영희");
    // 다른 대회에서 즐겨찾기: ID는 다르지만 이름이 같다
    const sub = { token: "B", favoriteIds: ["old-tournament-id"], favoriteNames: { 0: "김철수" } };
    expect(selectSubscriptions([sub], matchParticipants(match)).map((s) => s.token)).toEqual(["B"]);
  });

  it("names the favourite side and opponent", () => {
    expect(favoriteSideInfo(match, "p2")).toEqual({ favName: "이영희", oppName: "김철수", isP1: false });
    expect(favoriteSideInfo(team, "m1")).toEqual({ favName: "서울", oppName: "부산", isP1: true });
  });
});
