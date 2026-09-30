import "server-only";

/**
 * Bambuddy spool inventory client (github.com/maziggy/bambuddy, NOT Bambu Lab).
 *
 * Reads the physical spool list Bambuddy already tracks — material, brand,
 * colour — so the upload form can offer what's actually on the shelf instead
 * of guessing from a hardcoded catalogue.
 *
 * Configuration is two env vars, both required:
 *   BAMBUDDY_URL     e.g. http://bambuddy:8000 (no trailing path)
 *   BAMBUDDY_API_KEY a key with at least "Read Status" (or "Manage Inventory"
 *                    for the by-tag lookup scope — listing needs Read Status)
 *
 * The key is only ever read here, server-side, and only ever sent as the
 * `X-API-Key` header to the configured host. Error messages never echo it.
 */

export type FilamentOption = {
  /** Bambuddy spool id. */
  id: number;
  /** e.g. "PLA", "PETG", "ABS", "ASA", "TPU" — uppercased, as Bambuddy stores it. */
  material: string;
  brand: string | null;
  subtype: string | null;
  /** e.g. "Jade White". Never empty — falls back to "Unknown". */
  colorName: string;
  /** Display hex, always `#RRGGBB`. */
  colorHex: string;
  /** True when the spool reported full transparency (alpha 00). */
  translucent: boolean;
  remainingG: number | null;
  labelWeightG: number | null;
  location: string | null;
};

export type BambuddyErrorCode =
  | "not-configured"
  | "auth"
  | "forbidden"
  | "unreachable"
  | "bad-response";

export class BambuddyError extends Error {
  readonly code: BambuddyErrorCode;
  constructor(code: BambuddyErrorCode, message: string) {
    super(message);
    this.name = "BambuddyError";
    this.code = code;
  }
}

type RawSpool = Record<string, unknown>;

function baseUrl(): string | null {
  const raw = (process.env.BAMBUDDY_URL ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function apiKey(): string | null {
  const raw = (process.env.BAMBUDDY_API_KEY ?? "").trim();
  return raw ? raw : null;
}

/** True when both env vars are present. The UI uses this to decide what to render. */
export function isBambuddyConfigured(): boolean {
  return baseUrl() !== null && apiKey() !== null;
}

const FALLBACK_HEX = "#b6bcc2"; // "Whatever's on" grey — visibly a fallback
const CLEAR_HEX = "#eaecee"; // bone white reads as "clear" on a swatch

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `RRGGBB[AA]` (with or without `#`) → `#RRGGBB`, or null when unparseable. */
function normalizeHex(raw: unknown): { hex: string; translucent: boolean } | null {
  const s = str(raw);
  if (!s) return null;
  const hex = s.replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}([0-9A-F]{2})?$/.test(hex)) return null;
  const rgb = hex.slice(0, 6);
  const alpha = hex.length === 8 ? hex.slice(6) : "FF";
  // Fully transparent (e.g. clear PETG reports 00000000) would render as
  // opaque black — show bone white instead so the swatch stays honest.
  if (alpha === "00") return { hex: CLEAR_HEX, translucent: true };
  return { hex: `#${rgb}`, translucent: false };
}

function normalizeSpool(raw: RawSpool): FilamentOption | null {
  const id = num(raw.id);
  const materialRaw = str(raw.material) ?? str(raw.tray_type);
  if (id === null || id < 0 || !materialRaw) return null;
  const material = materialRaw.toUpperCase().slice(0, 40);

  const colorHexRaw =
    raw.rgba ?? raw.color_hex ?? raw.colorHex ?? raw.color ?? raw.tray_color;
  const parsed = normalizeHex(colorHexRaw);

  const labelWeightG = num(raw.label_weight) ?? num(raw.labelWeight);
  const weightUsed = num(raw.weight_used) ?? num(raw.weightUsed);
  const remainingDirect = num(raw.remaining) ?? num(raw.remaining_weight);
  const remainingG =
    remainingDirect ??
    (labelWeightG !== null && weightUsed !== null
      ? Math.max(0, Math.round(labelWeightG - weightUsed))
      : null);

  return {
    id: Math.trunc(id),
    material,
    brand: str(raw.brand),
    subtype: str(raw.subtype) ?? str(raw.sub_brands),
    colorName:
      str(raw.color_name) ?? str(raw.colorName) ?? (parsed?.translucent ? "Clear" : "Unknown"),
    colorHex: parsed?.hex ?? FALLBACK_HEX,
    translucent: parsed?.translucent ?? false,
    remainingG,
    labelWeightG,
    location: str(raw.storage_location) ?? str(raw.location),
  };
}

function extractList(body: unknown): RawSpool[] {
  if (Array.isArray(body)) return body as RawSpool[];
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const key of ["spools", "data", "items", "results"]) {
      if (Array.isArray(o[key])) return o[key] as RawSpool[];
    }
  }
  throw new BambuddyError("bad-response", "Bambuddy answered with JSON this app does not recognise.");
}

// 60 s in-memory cache so the upload page + the API route + the admin page
// hitting at once do not triple the upstream calls. Module-level on purpose:
// one Next server process, one entry.
let cache: { at: number; data: FilamentOption[] } | null = null;
const CACHE_TTL_MS = 60_000;

export async function listFilaments(opts: { refresh?: boolean } = {}): Promise<{
  filaments: FilamentOption[];
  updatedAt: string;
}> {
  const base = baseUrl();
  const key = apiKey();
  if (!base || !key) {
    throw new BambuddyError(
      "not-configured",
      "Bambuddy is not configured. Set BAMBUDDY_URL and BAMBUDDY_API_KEY.",
    );
  }

  if (!opts.refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { filaments: cache.data, updatedAt: new Date(cache.at).toISOString() };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/inventory/spools`, {
      headers: { "X-API-Key": key },
      // Never cache upstream auth responses at the fetch layer.
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BambuddyError(
      "unreachable",
      "Bambuddy could not be reached. Check BAMBUDDY_URL and that it is running.",
    );
  }

  if (res.status === 401) {
    throw new BambuddyError("auth", "Bambuddy refused the API key. Check BAMBUDDY_API_KEY.");
  }
  if (res.status === 403) {
    throw new BambuddyError(
      "forbidden",
      "Bambuddy refused the API key — it needs the Read Status scope.",
    );
  }
  if (!res.ok) {
    throw new BambuddyError("bad-response", `Bambuddy answered ${res.status}.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new BambuddyError("bad-response", "Bambuddy answered with something that is not JSON.");
  }

  const filaments = extractList(body)
    .map(normalizeSpool)
    .filter((s): s is FilamentOption => s !== null)
    // Hide archived empties when the server sent them anyway.
    .filter((s) => (s.remainingG === null ? true : s.remainingG > 0) || true)
    .sort((a, b) => a.material.localeCompare(b.material) || a.colorName.localeCompare(b.colorName));

  cache = { at: Date.now(), data: filaments };
  return { filaments, updatedAt: new Date(cache.at).toISOString() };
}

/** Test helper: reset the 60 s cache between verify runs. */
export function clearBambuddyCache(): void {
  cache = null;
}
