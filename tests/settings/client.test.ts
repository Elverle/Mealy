import { describe, it, expect, vi, afterEach } from "vitest";
import { putSettings, SettingsRequestError } from "@/lib/settings/client";
import { DEFAULT_MEAL_COMPOSITIONS, type SaveSettingsResult, type UpdateSettingsRequest } from "@/lib/domain/types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_BODY: UpdateSettingsRequest = {
  persons: 2,
  meals: ["pranzo", "cena"],
  meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
  meal_style_tags: ["veloce"],
  diet_tags: [],
  appliances: ["fornelli"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("putSettings", () => {
  it("returns the parsed data on a valid 200 response", async () => {
    const result: SaveSettingsResult = {
      settings: {
        persons: 2,
        meals: ["pranzo", "cena"],
        meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
        meal_style_tags: ["veloce"],
        diet_tags: [],
        appliances: ["fornelli"],
        onboarded: true,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      changed: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, result));
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).resolves.toEqual(result);
  });

  it("throws invalid_response on a 200 response with a non-conforming body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { nonsense: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
    });
  });

  it("throws invalid_response on a 200 response whose body is not JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
      message: "Risposta del server non valida.",
    });
  });

  it("throws with status 400 and code invalid_request on a 400 error body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: { code: "invalid_request", message: "Richiesta non valida." },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      message: "Richiesta non valida.",
    });
  });

  it("throws network_error when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).rejects.toMatchObject({
      status: 0,
      code: "network_error",
      message: "Connessione non disponibile.",
    });
  });

  it("throws unknown_error when a non-2xx response body cannot be parsed as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("not json", { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).rejects.toMatchObject({
      status: 500,
      code: "unknown_error",
    });
  });

  it("sends a PUT request with the given JSON body to /api/settings", async () => {
    const result: SaveSettingsResult = {
      settings: {
        persons: 2,
        meals: ["pranzo", "cena"],
        meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
        meal_style_tags: ["veloce"],
        diet_tags: [],
        appliances: ["fornelli"],
        onboarded: true,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      changed: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, result));
    vi.stubGlobal("fetch", fetchMock);

    await putSettings(VALID_BODY);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_BODY),
      })
    );
  });

  it("rejects instances of SettingsRequestError", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(putSettings(VALID_BODY)).rejects.toBeInstanceOf(SettingsRequestError);
  });
});
