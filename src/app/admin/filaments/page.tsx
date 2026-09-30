import Link from "next/link";

import { requireAdmin } from "@/lib/authz";
import { BambuddyError, isBambuddyConfigured, listFilaments } from "@/lib/bambuddy";
import { AppHeader } from "@/components/app-header";
import { Kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Filament stock, live from Bambuddy (github.com/maziggy/bambuddy).
 *
 * Admin-only, like the rest of /admin: it names what the printer owner has
 * on the shelf and where, which is their business, not the group's.
 * `?refresh=1` bypasses the 60 s server cache.
 */
export default async function FilamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>;
}) {
  const admin = await requireAdmin();
  const { refresh } = await searchParams;

  if (!isBambuddyConfigured()) {
    return (
      <>
        <AppHeader user={admin} active="/admin/filaments" />
        <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
          <Kicker>Filament stock</Kicker>
          <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
            Not connected
          </h1>
          <p className="m-0 max-w-[62ch] text-[15px] leading-[1.5] text-ink-2">
            Bambuddy is not configured. Set <span className="font-mono">BAMBUDDY_URL</span> and{" "}
            <span className="font-mono">BAMBUDDY_API_KEY</span> (an API key with at least the{" "}
            <em>Read Status</em> scope, from Bambuddy → Settings → API Keys), then restart the app.
            The upload form keeps working with its manual picker until then.
          </p>
        </main>
      </>
    );
  }

  let filaments: Awaited<ReturnType<typeof listFilaments>>["filaments"] = [];
  let updatedAt: string | null = null;
  let error: string | null = null;
  try {
    const res = await listFilaments({ refresh: refresh === "1" });
    filaments = res.filaments;
    updatedAt = res.updatedAt;
  } catch (e) {
    console.error("[admin/filaments] bambuddy fetch failed", e);
    error = e instanceof BambuddyError ? e.message : "Bambuddy could not be reached.";
  }

  const byMaterial = new Map<string, number>();
  for (const s of filaments) byMaterial.set(s.material, (byMaterial.get(s.material) ?? 0) + 1);

  return (
    <>
      <AppHeader user={admin} active="/admin/filaments" />
      <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <Kicker>Filament stock</Kicker>
        <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
          <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
            What&rsquo;s on the shelf
          </h1>
          <Link
            href="/admin/filaments?refresh=1"
            className="font-mono text-[12px] font-bold uppercase tracking-[0.06em] text-ink-3 underline underline-offset-4 hover:text-cherry-dk"
          >
            Refresh live
          </Link>
        </div>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          Live from Bambuddy spool inventory
          {updatedAt ? ` · updated ${new Date(updatedAt).toLocaleString()}` : ""} ·{" "}
          {filaments.length} spool{filaments.length === 1 ? "" : "s"}
          {byMaterial.size > 0 && ` (${[...byMaterial.entries()].map(([m, n]) => `${m} ×${n}`).join(", ")})`}.
          This is what the order form offers the group.
        </p>

        {error ? (
          <p className="m-0 mb-[22px] rounded-card border-[3px] border-ink bg-sun-wash px-[15px] py-[12px] text-[14px] text-ink-2">
            Live stock is unavailable ({error}).
          </p>
        ) : filaments.length === 0 ? (
          <p className="m-0 rounded-panel border-[3px] border-ink bg-porcelain p-[22px] font-mono text-[12px] uppercase tracking-[0.06em] text-ink-3">
            Bambuddy reports no spools.
          </p>
        ) : (
          <div className="overflow-hidden rounded-panel border-[3px] border-ink bg-porcelain shadow-stamp">
            {filaments.map((s, i) => (
              <div
                key={s.id}
                className={`flex flex-wrap items-center gap-[15px] p-[15px] ${
                  i < filaments.length - 1 ? "border-b-2 border-dashed border-rule" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="h-[40px] w-[40px] flex-none rounded-full border-[3px] border-ink"
                  style={{ background: s.colorHex }}
                />
                <div className="min-w-[180px] flex-[1_1_240px]">
                  <p className="m-0 font-display text-[17px] leading-[1.2] text-ink">
                    {s.material} · {s.colorName}
                  </p>
                  <p className="m-0 mt-[3px] font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
                    #{s.id}
                    {s.brand ? ` · ${s.brand}` : ""}
                    {s.subtype ? ` ${s.subtype}` : ""}
                    {s.remainingG !== null ? ` · ${s.remainingG} g left` : ""}
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
                  {s.colorHex}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
