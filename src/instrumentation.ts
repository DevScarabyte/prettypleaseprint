/**
 * Server startup hooks.
 *
 * Runs once when the server boots (not per request). Used for one thing:
 * a single Bambuddy connectivity line in the server log so the printer
 * owner can see at a glance whether live spool stock is working —
 * `[bambuddy] connected, 12 spools` vs why it is not.
 *
 * Fire-and-forget on purpose: startup must never wait on a second service.
 * The check races in the background and logs when it settles; the upload
 * form and /api/filaments re-check on first use either way.
 */
export async function register() {
  // Instrumentation runs in a context where Next-specific request APIs are
  // unavailable — keep this to the plain server client only.
  if (typeof window !== "undefined") return;

  try {
    const { BambuddyError, isBambuddyConfigured, listFilaments } =
      await import("@/lib/bambuddy");

    if (!isBambuddyConfigured()) {
      console.log(
        "[bambuddy] not configured (BAMBUDDY_URL / BAMBUDDY_API_KEY unset) — manual material picker active",
      );
      return;
    }

    // Don't hold up boot for this; log when the check settles.
    void listFilaments()
      .then(({ filaments }) => {
        const materials = [...new Set(filaments.map((s) => s.material))].sort().join(", ");
        console.log(
          `[bambuddy] connected, ${filaments.length} spool${filaments.length === 1 ? "" : "s"}` +
            (materials ? ` (${materials})` : ""),
        );
      })
      .catch((error: unknown) => {
        const message =
          error instanceof BambuddyError ? error.message : "Bambuddy could not be reached.";
        console.warn(`[bambuddy] ${message}`);
      });
  } catch (error) {
    console.warn("[bambuddy] startup check skipped", error);
  }
}
