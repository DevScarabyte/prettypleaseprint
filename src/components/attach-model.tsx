"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  formatBytes,
} from "@/lib/upload-limits";
import { Button, Notice } from "@/components/ui";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string };

/**
 * The owner puts the printable model on a ticket.
 *
 * This is how a link or description request becomes printable: the owner
 * fetches the file from the link (or draws what was described) and attaches
 * the bytes here. On a file ticket it replaces the model instead. Either way
 * the bytes go through the same inspection as an upload, the requester is
 * told, and the link / description the request arrived with is kept.
 *
 * XHR rather than fetch, like the upload form: the only way to show a real
 * progress bar for a large model over office wifi.
 */
export function AttachModel({
  storyId,
  hasFile,
}: {
  storyId: number;
  /** Whether a model is already on the ticket — "replace" reads honestly. */
  hasFile: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  function pick(next: File | null) {
    setPhase({ kind: "idle" });
    fileRef.current = null;
    if (!next) return setPicked(null);

    const ext = next.name.slice(next.name.lastIndexOf(".")).toLowerCase();
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      setPicked(null);
      return setPhase({
        kind: "error",
        message: "Only .stl and .3mf files can be printed here.",
      });
    }
    if (next.size > MAX_UPLOAD_BYTES) {
      setPicked(null);
      return setPhase({
        kind: "error",
        message: `That file is ${formatBytes(next.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      });
    }
    fileRef.current = next;
    setPicked(next.name);
  }

  function send() {
    const file = fileRef.current;
    if (!file || phase.kind === "uploading") return;

    const body = new FormData();
    body.set("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/stories/${storyId}/model`);
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setPhase({
        kind: "uploading",
        percent: Math.round((event.loaded / event.total) * 100),
      });
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let filename = picked ?? "model";
        try {
          filename = JSON.parse(xhr.responseText).attached?.filename ?? filename;
        } catch {
          /* the ticket refresh says what landed */
        }
        fileRef.current = null;
        setPicked(null);
        if (inputRef.current) inputRef.current.value = "";
        setPhase({ kind: "done", message: `${filename} is on the ticket now.` });
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
    <div className="mt-[13.2px] rounded-card border-[3px] border-ink bg-porcelain p-[13.2px]">
      <p className="m-0 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink-2">
        {hasFile ? "Replace the model" : "Attach the printable model"}
      </p>
      <div className="mt-[8.8px] flex flex-wrap items-center gap-[8.8px]">
        <label className="stamp inline-flex cursor-pointer items-center gap-[8px] rounded-chip border-[3px] border-ink bg-cream px-[15px] py-[7px] text-[13.5px] font-bold text-ink hover:bg-sun">
          <input
            ref={inputRef}
            type="file"
            accept=".stl,.3mf,model/stl,model/3mf"
            className="sr-only"
            disabled={busy}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          {picked ? picked : "Choose a .stl or .3mf"}
        </label>
        <Button type="button" disabled={!picked || busy} onClick={send}>
          {busy ? `Sending… ${phase.percent}%` : hasFile ? "Replace it" : "Attach it"}
        </Button>
      </div>
      {busy && (
        <span className="mt-[8.8px] block h-[10px] overflow-hidden rounded-full border-[3px] border-ink bg-cream-2">
          <span
            className="block h-full bg-cherry transition-[width] duration-200"
            style={{ width: `${phase.percent}%` }}
          />
        </span>
      )}
      {phase.kind === "error" && (
        <div className="mt-[8.8px]">
          <Notice tone="warn">{phase.message}</Notice>
        </div>
      )}
      {phase.kind === "done" && (
        <p className="m-0 mt-[8.8px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-cherry-dk">
          {phase.message}
        </p>
      )}
      {!picked && phase.kind === "idle" && (
        <p className="m-0 mt-[8.8px] font-mono text-[11px] leading-[1.5] text-ink-3">
          The requester is told, and the original link or description stays on
          the ticket.
        </p>
      )}
    </div>
  );
}
