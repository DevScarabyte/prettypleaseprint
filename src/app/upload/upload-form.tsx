"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  COLORS,
  DEFAULT_COLOR,
  DEFAULT_MATERIAL,
  MATERIALS,
  QUANTITY_PRESETS,
  hexForColor,
} from "@/lib/catalog";
// The same numbers the server enforces. `models.ts` cannot be imported here —
// it would pull `fflate` and the mesh parser into the browser bundle — which
// is why these three used to be copied into this file by hand.
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  formatBytes,
} from "@/lib/upload-limits";
import type { SourceType } from "@/lib/catalog";
import { FilamentPicker } from "./filament-picker";

/** One owner-managed tip option, passed from the server (see upload/page.tsx). */
type Benefit = { label: string; preferred: boolean };
import { Button, Label, Notice } from "@/components/ui";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "error"; message: string };

/** Segmented control. Handoff §3: track #eaecee, 3px inset, 6px options. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  mono = false,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  mono?: boolean;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-[6px]"
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`flex-1 cursor-pointer rounded-chip border-[3px] border-ink px-[10px] py-[8px] font-mono text-[12.5px] font-bold uppercase tracking-[0.06em] transition-colors ${
              active
                ? "bg-cherry-dk text-cream"
                : "bg-porcelain text-ink hover:bg-sun"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function UploadForm({
  owner,
  benefits,
}: {
  owner: string;
  benefits: Benefit[];
}) {
  // Default to a preferred benefit if the owner has marked one, else the first
  // on the list, else empty (the list is seeded, so empty is only a safety net).
  const preferredLabels = benefits.filter((b) => b.preferred).map((b) => b.label);
  const defaultTip = preferredLabels[0] ?? benefits[0]?.label ?? "";
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const [sourceType, setSourceType] = useState<SourceType>("file");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");

  const [title, setTitle] = useState("");
  const [material, setMaterial] = useState<string>(DEFAULT_MATERIAL);
  const [quantity, setQuantity] = useState<number>(1);
  const [color, setColor] = useState<string>(DEFAULT_COLOR.name);
  const [colorHex, setColorHex] = useState<string>(DEFAULT_COLOR.hex);
  const [tip, setTip] = useState<string>(defaultTip);
  const [note, setNote] = useState("");
  const [printSettings, setPrintSettings] = useState("");

  /**
   * Client-side checks are for fast feedback only — the server re-runs all of
   * them against the actual bytes and is the one that decides.
   */
  const accept = useCallback((picked: File | null) => {
    setPhase({ kind: "idle" });
    if (!picked) return setFile(null);

    const ext = picked.name.slice(picked.name.lastIndexOf(".")).toLowerCase();
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      setFile(null);
      return setPhase({
        kind: "error",
        message: "Only .stl and .3mf files can be printed here.",
      });
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      return setPhase({
        kind: "error",
        message: `That file is ${formatBytes(picked.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      });
    }
    setFile(picked);
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files?.[0] ?? null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind === "uploading") return;

    // Client-side checks are for fast feedback only — the server re-runs all
    // of them and is the one that decides.
    if (sourceType === "file" && !file) return;
    if (sourceType === "link") {
      try {
        const u = new URL(sourceUrl.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch {
        setPhase({ kind: "error", message: "That does not look like an http(s) link." });
        return;
      }
    }
    if (sourceType === "description" && description.trim().length < 10) {
      setPhase({
        kind: "error",
        message: "Say a little more — what should it be, roughly how big?",
      });
      return;
    }

    const body = new FormData();
    body.set("sourceType", sourceType);
    if (sourceType === "file" && file) body.set("file", file);
    body.set("sourceUrl", sourceType === "link" ? sourceUrl.trim() : "");
    body.set("description", sourceType === "description" ? description.trim() : "");
    body.set("title", title);
    body.set("material", material);
    body.set("colorName", color);
    body.set("colorHex", colorHex);
    body.set("quantity", String(quantity));
    body.set("tip", tip);
    body.set("note", note);
    body.set("printSettings", printSettings);

    // XHR rather than fetch: it is still the only way to observe upload
    // progress, and a large model over office wifi needs a real bar.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setPhase({
        kind: "uploading",
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Handoff §3: submitting navigates to the new story's detail view.
        let id: number | null = null;
        try {
          id = JSON.parse(xhr.responseText).id ?? null;
        } catch {
          /* fall back to the board rather than stranding them here */
        }
        router.push(id === null ? "/board" : `/story/${id}?sent=1`);
        router.refresh();
        return;
      }
      let message = "That did not go through. Try again.";
      try {
        message = JSON.parse(xhr.responseText).error ?? message;
      } catch {
        /* a non-JSON error body is not worth surfacing verbatim */
      }
      setPhase({ kind: "error", message });
    });
    xhr.addEventListener("error", () =>
      setPhase({ kind: "error", message: "The connection dropped mid-upload." }),
    );
    xhr.addEventListener("abort", () => setPhase({ kind: "idle" }));

    setPhase({ kind: "uploading", percent: 0 });
    xhr.send(body);
  }

  const busy = phase.kind === "uploading";

  return (
    <form onSubmit={submit} className="max-w-[780px]">
      {/* ---- how the model arrives: file, link, or description ---- */}
      <div role="tablist" aria-label="How to share the model" className="flex flex-wrap gap-[8.8px]">
        {(
          [
            { value: "file", label: "Upload a file" },
            { value: "link", label: "Paste a link" },
            { value: "description", label: "Describe it" },
          ] as const
        ).map((tab) => {
          const active = sourceType === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setSourceType(tab.value);
                setPhase({ kind: "idle" });
              }}
              className={`stamp cursor-pointer rounded-chip border-[3px] border-ink px-[18px] py-[9px] text-[14px] font-bold transition-colors ${
                active ? "bg-cherry-dk text-cream" : "bg-porcelain text-ink hover:bg-sun"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {sourceType === "file" && (
        <>
          {/* ---- dropzone ---- */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            /*
             * focus-within, because the input it wraps is visually hidden and its
             * own outline would be drawn on a 1px clipped box nobody can see. The
             * label carries the visuals, so the label shows the focus. Same colour
             * and offset as the global ring in globals.css.
             */
            className={`mt-[13.2px] block cursor-pointer rounded-panel border-[3px] border-dashed px-[26.4px] py-[35.2px] text-center transition-colors focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-cherry-dk ${
              dragging
                ? "border-ink bg-sun"
                : "border-ink-3 bg-porcelain hover:border-ink hover:bg-sun-wash"
            }`}
          >
            {/*
             * sr-only, NOT hidden.
             *
             * This was `className="hidden"` — display:none — which takes the input
             * out of the focus order entirely. A <label> is not focusable, so there
             * was no tab stop anywhere that opened the file picker, and the submit
             * button is disabled until a file is chosen. A keyboard or screen-reader
             * user therefore could not upload anything at all: the app's primary
             * function, unreachable, with no error and nothing to notice.
             *
             * sr-only clips it to a 1px box instead of removing it, so it stays
             * focusable and operable (Space and Enter open the picker) while the
             * dropzone above keeps every bit of the visual design.
             */}
            <input
              ref={inputRef}
              type="file"
              accept=".stl,.3mf,model/stl,model/3mf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => accept(e.target.files?.[0] ?? null)}
            />
            <span
              aria-hidden
              className="mx-auto mb-[13.2px] block h-[56px] w-[56px] rounded-full border-[3px] border-ink bg-aqua"
            />
            <span className="block font-display text-[19px] text-ink">
              {file ? file.name : "Drop your .stl or .3mf here"}
            </span>
            <span className="mt-[6px] block font-mono text-[12px] uppercase tracking-[0.04em] text-ink-3">
              {busy
                ? `Uploading… ${phase.percent}%`
                : file
                  ? `${formatBytes(file.size)} · checked on the server when you send it`
                  : `or click to choose a file · ${formatBytes(MAX_UPLOAD_BYTES)} max`}
            </span>

            {busy && (
              <span className="mt-[13.2px] block h-[10px] overflow-hidden rounded-full border-[3px] border-ink bg-cream-2">
                <span
                  className="block h-full bg-cherry transition-[width] duration-200"
                  style={{ width: `${phase.percent}%` }}
                />
              </span>
            )}
          </label>
        </>
      )}

      {sourceType === "link" && (
        <div className="mt-[13.2px] rounded-panel border-[3px] border-ink bg-porcelain p-[22px]">
          <Label htmlFor="sourceUrl">Link to the model</Label>
          <input
            id="sourceUrl"
            type="url"
            inputMode="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            maxLength={2000}
            placeholder="https://www.printables.com/model/…"
            className="w-full rounded-card border-[3px] border-ink bg-cream px-[15px] py-[12px] font-mono text-[15px] text-ink placeholder:text-ink-3"
          />
          <p className="m-0 mt-[8px] text-[14px] leading-[1.5] text-ink-2">
            Printables, Thingiverse, MakerWorld — anywhere {owner} can fetch it.
            No account of yours is ever touched.
          </p>
        </div>
      )}

      {sourceType === "description" && (
        <div className="mt-[13.2px] rounded-panel border-[3px] border-ink bg-porcelain p-[22px]">
          <Label htmlFor="description">Describe the print you want</Label>
          <textarea
            id="description"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={4000}
            placeholder="A hook that slides onto the 25 mm monitor arm, about 60 mm long, needs to hold a pair of headphones…"
            className="w-full resize-y rounded-card border-[3px] border-ink bg-cream px-[15px] py-[12px] text-[16px] leading-[1.5] text-ink placeholder:text-ink-3"
          />
          <p className="m-0 mt-[8px] text-[14px] leading-[1.5] text-ink-2">
            What it is, roughly how big, what it has to survive. {owner} draws
            the model from this — the more concrete, the fewer questions.
          </p>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="mt-[13.2px]">
          <Notice tone="warn">{phase.message}</Notice>
        </div>
      )}

      {/* ---- live stock from Bambuddy (renders nothing when unconfigured) ---- */}
      <FilamentPicker
        current={{ material, colorName: color, colorHex }}
        onPick={(spool) => {
          setMaterial(spool.material);
          setColor(spool.colorName);
          setColorHex(spool.colorHex.toLowerCase());
        }}
      />

      {/* ---- title + material ---- */}
      <div className="mt-[26.4px] grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-[22px]">
        <div>
          <Label htmlFor="title">What is it?</Label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Hook for the monitor arm"
            className="w-full rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[12px] text-[16px] text-ink placeholder:text-ink-3"
          />
        </div>
        <div>
          <Label htmlFor="material">Material you&rsquo;d like</Label>
          <Segmented
            label="Material"
            options={MATERIALS}
            value={(MATERIALS as readonly string[]).includes(material) ? material : MATERIALS[0]}
            onChange={(v) => setMaterial(v)}
          />
          {!(MATERIALS as readonly string[]).includes(material) ? (
            <p className="m-0 mt-[8px] flex items-center gap-[8px] font-mono text-[12px] font-bold uppercase tracking-[0.04em] text-cherry-dk">
              From the shelf: {material} — or pick above to override.
            </p>
          ) : null}
          <div className="mt-[8.8px] flex items-center gap-[8.8px]">
            <label htmlFor="material-other" className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
              or another
            </label>
            <input
              id="material-other"
              value={(MATERIALS as readonly string[]).includes(material) ? "" : material}
              onChange={(e) => {
                const v = e.target.value.trim().toUpperCase();
                if (v) setMaterial(v.slice(0, 40));
              }}
              maxLength={40}
              placeholder="ABS, ASA, …"
              className="w-[160px] rounded-card border-[3px] border-ink bg-porcelain px-[10px] py-[6px] font-mono text-[14px] font-bold uppercase text-ink placeholder:text-ink-3"
            />
          </div>
        </div>
      </div>

      {/* ---- quantity ---- */}
      <div className="mt-[22px] max-w-[320px]">
        <Label htmlFor="quantity">How many do you need?</Label>
        <Segmented
          label="Quantity"
          mono
          options={QUANTITY_PRESETS}
          value={QUANTITY_PRESETS.includes(quantity as never) ? quantity : 0}
          onChange={setQuantity}
        />
        <div className="mt-[8.8px] flex items-center gap-[8.8px]">
          <label htmlFor="quantity-other" className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
            or type a number
          </label>
          <input
            id="quantity-other"
            type="number"
            min={1}
            max={24}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="w-[80px] rounded-card border-[3px] border-ink bg-porcelain px-[10px] py-[6px] font-mono text-[14px] font-bold tabular-nums text-ink"
          />
        </div>
      </div>

      {/* ---- colour ---- */}
      <fieldset className="mt-[22px] border-0 p-0">
        <legend className="mb-[8.8px] font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">
          Colour you&rsquo;re hoping for
        </legend>
        {!(COLORS as readonly { name: string }[]).some((c) => c.name === color) && (
          <p className="m-0 mb-[8px] flex items-center gap-[8px] text-[14px] font-bold text-ink">
            <span
              aria-hidden
              className="inline-block h-[24px] w-[24px] rounded-full border-[3px] border-ink"
              style={{ background: colorHex }}
            />
            From the shelf: {color}
          </p>
        )}
        <div className="flex flex-wrap gap-[13.2px]">
          {COLORS.map((c) => {
            const active = c.name === color;
            return (
              <button
                key={c.name}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${c.name} filament`}
                onClick={() => {
                  setColor(c.name);
                  setColorHex(c.hex.toLowerCase());
                }}
                className="flex w-[80px] cursor-pointer flex-col items-center gap-[7px] border-0 bg-transparent p-0"
              >
                <span
                  aria-hidden
                  className={`h-[48px] w-[48px] rounded-full border-[3px] border-ink transition-transform ${
                    active ? "scale-110 ring-[4px] ring-cherry-dk ring-offset-2 ring-offset-cream" : ""
                  }`}
                  style={{ background: c.hex }}
                />
                <span
                  className={`font-mono text-[11px] font-bold uppercase tracking-[0.04em] ${
                    active ? "text-cherry-dk" : "text-ink-2"
                  }`}
                >
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-[11px] font-mono text-[11.5px] uppercase tracking-[0.04em] text-ink-3">
          {owner} confirms what&rsquo;s actually on the spool.
        </p>
      </fieldset>

      {/* ---- the tip jar ---- */}
      {/*
        A fieldset with a floated full-width legend broke the layout here: the
        float took the whole row and squeezed the pills into a vertical stack.
        A labelled radiogroup does the same job for assistive tech without
        fighting the box model.
      */}
      <section
        aria-labelledby="tip-heading"
        className="mt-[26.4px] rounded-panel border-[3px] border-ink bg-aqua-wash p-[22px] shadow-stamp"
      >
        <h2 id="tip-heading" className="m-0 mb-[4px] font-display text-[22px] text-ink">
          And what&rsquo;s in it for {owner}?
        </h2>
        <p className="m-0 mb-[8px] text-[14.5px] text-ink-2">
          Optional. Nobody is counting. {owner} is counting a little.
        </p>
        {preferredLabels.length > 0 && (
          <p className="m-0 mb-[15px] font-mono text-[12px] font-bold uppercase tracking-[0.04em] text-cherry-dk">
            ★ {owner} currently prefers: {preferredLabels.join(", ")}
          </p>
        )}
        <div role="radiogroup" aria-labelledby="tip-heading" className="flex flex-wrap gap-[8.8px]">
          {benefits.map((b) => {
            const active = b.label === tip;
            return (
              <button
                key={b.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTip(b.label)}
                className={`stamp cursor-pointer rounded-chip border-[3px] border-ink px-[18px] py-[9px] text-[14px] font-bold transition-colors ${
                  active ? "bg-cherry-dk text-cream" : "bg-porcelain text-ink hover:bg-sun"
                }`}
              >
                {b.preferred && (
                  <span aria-label="preferred" title="Preferred">
                    ★{" "}
                  </span>
                )}
                {b.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- note ---- */}
      <div className="mt-[22px]">
        {/* Named, not "he" — the printer owner is a role anyone can hold. */}
        <Label htmlFor="note">Anything {owner} should know</Label>
        <textarea
          id="note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={2000}
          placeholder="No rush — needs to survive a bit of pulling."
          className="w-full resize-y rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[12px] text-[16px] text-ink placeholder:text-ink-3"
        />
      </div>

      {/* ---- print settings (optional, FRR-103) ---- */}
      <div className="mt-[22px]">
        <Label htmlFor="printSettings">Print settings (optional)</Label>
        <textarea
          id="printSettings"
          rows={3}
          value={printSettings}
          onChange={(e) => setPrintSettings(e.target.value)}
          maxLength={2000}
          placeholder="Any specific slicer settings: layer height, infill, supports, temps…"
          className="w-full resize-y rounded-card border-[3px] border-ink bg-porcelain px-[15px] py-[12px] font-mono text-[15px] text-ink placeholder:text-ink-3"
        />
        <p className="m-0 mt-[6px] font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
          Comes with some files — saves a round of messages with {owner}.
        </p>
      </div>

      {/* ---- actions ---- */}
      <div className="mt-[26.4px] flex flex-wrap items-center gap-[13.2px]">
        <Button
          type="submit"
          disabled={
            busy ||
            (sourceType === "file" && !file) ||
            (sourceType === "link" && !sourceUrl.trim()) ||
            (sourceType === "description" && description.trim().length < 10)
          }
          className="px-[30px]"
        >
          {busy ? `Sending… ${phase.percent}%` : `Send it to ${owner}`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/board")}>
          Cancel
        </Button>
        {sourceType === "file" && !file && (
          <span className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Pick a file to continue.</span>
        )}
        {sourceType === "link" && !sourceUrl.trim() && (
          <span className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Paste a link to continue.</span>
        )}
        {sourceType === "description" && description.trim().length < 10 && (
          <span className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">Describe it in a sentence or two.</span>
        )}
      </div>
    </form>
  );
}
