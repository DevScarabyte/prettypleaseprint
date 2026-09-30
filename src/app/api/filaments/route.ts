import { ok, withActor } from "@/lib/api";
import {
  BambuddyError,
  isBambuddyConfigured,
  listFilaments,
} from "@/lib/bambuddy";

/**
 * Live spool stock from Bambuddy (github.com/maziggy/bambuddy).
 *
 * `GET /api/filaments` — needs a session like everything else. Answers 200
 * even when Bambuddy is down or unconfigured: `{ configured, filaments, ... }`
 * with an `error` sentence the UI can show, so the upload form degrades to
 * its manual material/colour picker instead of breaking the order flow.
 * `?refresh=1` bypasses the 60 s server cache.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withActor(async (request) => {
  if (!isBambuddyConfigured()) {
    return ok({ configured: false as const, filaments: [], updatedAt: null });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const { filaments, updatedAt } = await listFilaments({ refresh });
    return ok({ configured: true as const, filaments, updatedAt });
  } catch (error) {
    // The key/host never go on the wire — the sentence is generic on purpose.
    console.error("[filaments] bambuddy fetch failed", error);
    const message =
      error instanceof BambuddyError
        ? error.message
        : "Bambuddy could not be reached.";
    return ok({
      configured: true as const,
      filaments: [],
      updatedAt: null,
      error: message,
    });
  }
});
