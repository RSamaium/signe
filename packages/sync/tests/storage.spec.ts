import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenStorage } from "../src/client/storage";

describe("TokenStorage", () => {
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: localStorageMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves, reads, and removes the party token", async () => {
    localStorageMock.getItem.mockReturnValue("saved-token");

    await TokenStorage.saveToken("saved-token");
    await expect(TokenStorage.getToken()).resolves.toBe("saved-token");
    TokenStorage.removeToken();

    expect(localStorageMock.setItem).toHaveBeenCalledWith("party_token", "saved-token");
    expect(localStorageMock.getItem).toHaveBeenCalledWith("party_token");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith("party_token");
  });

  it("swallows localStorage failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("set failed");
    });
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error("get failed");
    });
    localStorageMock.removeItem.mockImplementation(() => {
      throw new Error("remove failed");
    });

    await expect(TokenStorage.saveToken("token")).resolves.toBeUndefined();
    await expect(TokenStorage.getToken()).resolves.toBeNull();
    expect(() => TokenStorage.removeToken()).not.toThrow();

    expect(console.error).toHaveBeenCalledWith("Failed to save token:", expect.any(Error));
    expect(console.error).toHaveBeenCalledWith("Failed to get token:", expect.any(Error));
    expect(console.error).toHaveBeenCalledWith("Failed to remove token:", expect.any(Error));
  });
});
