"use client";

import { useEffect, useState } from "react";

export type SpoolPick = {
  material: string;
  colorName: string;
  colorHex: string;
};

type Spool = {
  id: number;
  material: string;
  brand: string | null;
  subtype: string | null;
  colorName: string;
  colorHex: string;
  remainingG: number | null;
  labelWeightG: number | null;
  location: string | null;
};

/**
 * Live "what's on the shelf" picker, backed by Bambuddy spool inventory.
 *
 * Renders nothing when Bambuddy is not configured (the manual material +
 * colour controls below remain the whole form). When the fetch fails it
 * renders one honest warning line — the order flow must never depend on a
 * second service being up.
 */
export function FilamentPicker({
  onPick,
  current,
}: {
  onPick: (spool: SpoolPick) => void;
  current: SpoolPick | null;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "off" }
    | { kind: "error"; message: string }
    | { kind: "ready"; spools: Spool[]; updatedAt: string | null }
  >({ kind: "loading" });
  const [materialFilter, setMaterialFilter] = useState<string>("");

  useEffect(() => {
    let live = true;
    fetch("/api/filaments", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body) => {
        if (!live) return;
        if (!body.configured) {
          setState({ kind: "off" });
          return;
        }
        if (body.error) {
          setState({ kind: "error", message: String(body.error) });
          return;
        }
        setState({
          kind: "ready",
          spools: (body.filaments ?? []) as Spool[],
          updatedAt: body.updatedAt ?? null,
        });
      })
      .catch(() => {
        if (live) setState({ kind: "error", message: "Live stock could not be reached." });
      });
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "loading") {
    return (
      <p className="m-0 mt-[22px] font-mono text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
        Checking what&rsquo;s on the shelf…
      </p>
    );
  }
  if (state.kind === "off") return null;
  if (state.kind === "error") {
    return (
      <p className="m-0 mt-[22px] rounded-card border-[3px] border-ink bg-sun-wash px-[15px] py-[12px] text-[14px] text-ink-2">
        Live filament stock is unavailable ({state.message}) — pick the material
        and colour below and {`the owner`} will confirm.
      </p>
    );
  }

  const materials = Array.from(new Set(state.spools.map((s) => s.material))).sort();
  const visible = materialFilter
    ? state.spools.filter((s) => s.material === materialFilter)
    : state.spools;

  return (
    <section aria-label="What's on the shelf" className="mt-[22px] rounded-panel border-[3px] border-ink bg-cream-2 p-[22px] shadow-stamp">
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <h2 className="m-0 font-display text-[22px] text-ink">What&rsquo;s on the shelf</h2>
        {state.updatedAt && (
          <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
            Live from Bambuddy · {new Date(state.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <p className="m-0 mt-[4px] mb-[12px] text-[14.5px] text-ink-2">
        Pick a spool and the material + colour below follow it. Anything here is
        already in the building.
      </p>

      {state.spools.length === 0 ? (
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.06em] text-ink-3">
          No spools reported — pick manually below.
        </p>
      ) : (
        <>
          {materials.length > 1 && (
            <div className="mb-[12px] flex flex-wrap gap-[6px]" role="group" aria-label="Filter by material">
              <button
                type="button"
                onClick={() => setMaterialFilter("")}
                aria-pressed={materialFilter === ""}
                className={`cursor-pointer rounded-chip border-[3px] border-ink px-[12px] py-[6px] font-mono text-[12px] font-bold uppercase ${
                  materialFilter === "" ? "bg-cherry-dk text-cream" : "bg-porcelain text-ink hover:bg-sun"
                }`}
              >
                All
              </button>
              {materials.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMaterialFilter(m)}
                  aria-pressed={materialFilter === m}
                  className={`cursor-pointer rounded-chip border-[3px] border-ink px-[12px] py-[6px] font-mono text-[12px] font-bold uppercase ${
                    materialFilter === m ? "bg-cherry-dk text-cream" : "bg-porcelain text-ink hover:bg-sun"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[8.8px] p-0">
            {visible.slice(0, 24).map((s) => {
              const active =
                current?.material === s.material && current?.colorHex === s.colorHex.toLowerCase();
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({ material: s.material, colorName: s.colorName, colorHex: s.colorHex })
                    }
                    aria-pressed={active}
                    className={`flex w-full cursor-pointer items-center gap-[10px] rounded-card border-[3px] border-ink px-[12px] py-[10px] text-left transition-colors ${
                      active ? "bg-aqua" : "bg-porcelain hover:bg-sun-wash"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="h-[32px] w-[32px] flex-none rounded-full border-2 border-ink"
                      style={{ background: s.colorHex }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold text-ink">
                        {s.material} · {s.colorName}
                      </span>
                      <span className="block truncate font-mono text-[11px] uppercase text-ink-3">
                        {s.brand ?? "Unknown brand"}
                        {s.remainingG !== null ? ` · ${s.remainingG} g left` : ""}
                        {s.location ? ` · ${s.location}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length > 24 && (
            <p className="m-0 mt-[8px] font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
              Showing 24 of {visible.length} — filter by material to narrow it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
