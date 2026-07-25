/**
 * Tests for the Phase 3 password-quality helpers:
 * generateSuggestedPassword / isCommonPassword / isReusedPassword.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PASSWORD_OPTIONS,
  generateSuggestedPassword,
  isCommonPassword,
  isReusedPassword,
  type PasswordGenerationOptions,
  type VaultItemSecret,
} from "../crypto.js";

const item = (password: string): VaultItemSecret => ({
  siteName: "example.com",
  username: "mina",
  password,
});

describe("generateSuggestedPassword", () => {
  it("returns a password of the requested length", () => {
    for (const length of [8, 20, 64, 128]) {
      expect(generateSuggestedPassword({ ...DEFAULT_PASSWORD_OPTIONS, length })).toHaveLength(length);
    }
  });

  it("uses the default options (length 20, all classes) when called with none", () => {
    const pw = generateSuggestedPassword();
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
  });

  it("includes at least one character from every enabled class", () => {
    // Run repeatedly: the guarantee must hold every time, not just on average.
    for (let i = 0; i < 200; i++) {
      const pw = generateSuggestedPassword({
        length: 4, // exact fit: 4 classes into 4 chars, so each must appear exactly once
        includeLowercase: true,
        includeUppercase: true,
        includeDigits: true,
        includeSymbols: true,
      });
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it("only draws from the enabled classes", () => {
    const pw = generateSuggestedPassword({
      length: 40,
      includeLowercase: true,
      includeUppercase: false,
      includeDigits: false,
      includeSymbols: false,
    });
    expect(pw).toMatch(/^[a-z]+$/);
  });

  it("produces a different password almost every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateSuggestedPassword());
    expect(seen.size).toBe(100);
  });

  it("rejects a non-positive length", () => {
    for (const length of [0, -5]) {
      expect(() => generateSuggestedPassword({ ...DEFAULT_PASSWORD_OPTIONS, length })).toThrow(
        /positive integer/,
      );
    }
  });

  it("rejects a non-integer length", () => {
    expect(() => generateSuggestedPassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 12.5 })).toThrow(
      /positive integer/,
    );
  });

  it("rejects a length too small to fit one of each selected class", () => {
    // 2 chars can't hold all 4 classes.
    expect(() =>
      generateSuggestedPassword({
        length: 2,
        includeLowercase: true,
        includeUppercase: true,
        includeDigits: true,
        includeSymbols: true,
      }),
    ).toThrow(/at least 4/);
  });

  it("rejects when no character class is enabled", () => {
    const none: PasswordGenerationOptions = {
      length: 20,
      includeLowercase: false,
      includeUppercase: false,
      includeDigits: false,
      includeSymbols: false,
    };
    expect(() => generateSuggestedPassword(none)).toThrow(/at least one character class/i);
  });

});

describe("isCommonPassword", () => {
  it("flags well-known weak passwords", () => {
    for (const pw of ["password", "123456", "qwerty", "letmein", "iloveyou"]) {
      expect(isCommonPassword(pw)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isCommonPassword("PASSWORD")).toBe(true);
    expect(isCommonPassword("QwErTy")).toBe(true);
  });

  it("does not flag a strong, unique password", () => {
    expect(isCommonPassword(generateSuggestedPassword())).toBe(false);
    expect(isCommonPassword("gT7#vq!2Lm@0zR")).toBe(false);
  });
});

describe("isReusedPassword", () => {
  const vault = [item("hunter2"), item("s3cr3t-vault-key"), item("another-one")];

  it("detects a password already used by a vault item", () => {
    expect(isReusedPassword("s3cr3t-vault-key", vault)).toBe(true);
  });

  it("returns false for a password not in the vault", () => {
    expect(isReusedPassword("brand-new-password", vault)).toBe(false);
  });

  it("is case-sensitive (different case is a different password)", () => {
    expect(isReusedPassword("Hunter2", vault)).toBe(false);
  });

  it("returns false against an empty vault", () => {
    expect(isReusedPassword("anything", [])).toBe(false);
  });
});
