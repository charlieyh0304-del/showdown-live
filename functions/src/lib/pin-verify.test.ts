import { describe, it, expect } from "vitest";
import {
  hashPinSHA256Sync,
  hashPinPBKDF2Sync,
  verifyPinAgainstStored,
  findAdminByPin,
} from "./pin-verify";

describe("pin-verify", () => {
  describe("SHA-256 (legacy)", () => {
    it("matches correct PIN", () => {
      const stored = hashPinSHA256Sync("1234");
      expect(verifyPinAgainstStored("1234", stored)).toBe(true);
    });
    it("rejects wrong PIN", () => {
      const stored = hashPinSHA256Sync("1234");
      expect(verifyPinAgainstStored("9999", stored)).toBe(false);
    });
  });

  describe("PBKDF2 (new)", () => {
    it("matches correct PIN with salt", () => {
      const stored = hashPinPBKDF2Sync("hello", "randomsalt");
      expect(verifyPinAgainstStored("hello", stored)).toBe(true);
    });
    it("rejects wrong PIN", () => {
      const stored = hashPinPBKDF2Sync("hello", "randomsalt");
      expect(verifyPinAgainstStored("world", stored)).toBe(false);
    });
    it("rejects malformed stored (too many colons)", () => {
      expect(verifyPinAgainstStored("hello", "a:b:c")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("rejects empty stored", () => {
      expect(verifyPinAgainstStored("1234", "")).toBe(false);
    });
  });

  describe("findAdminByPin", () => {
    it("returns matching admin id", () => {
      const admins = {
        alice: { pinHash: hashPinSHA256Sync("1111") },
        bob: { pinHash: hashPinPBKDF2Sync("2222", "saltB") },
      };
      expect(findAdminByPin(admins, "1111")).toBe("alice");
      expect(findAdminByPin(admins, "2222")).toBe("bob");
    });
    it("returns null when no match", () => {
      const admins = { alice: { pinHash: hashPinSHA256Sync("1111") } };
      expect(findAdminByPin(admins, "9999")).toBeNull();
    });
    it("handles empty/null admins", () => {
      expect(findAdminByPin(null, "1234")).toBeNull();
      expect(findAdminByPin({}, "1234")).toBeNull();
    });
    it("skips admin with no pinHash", () => {
      const admins = {
        alice: {},
        bob: { pinHash: hashPinSHA256Sync("2222") },
      };
      expect(findAdminByPin(admins, "2222")).toBe("bob");
    });
  });
});
