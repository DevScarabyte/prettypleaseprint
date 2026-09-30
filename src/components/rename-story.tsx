"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Notice } from "@/components/ui";

/**
 * Rename a ticket, inline under its title.
 *
 * The person who asked for it, or the printer owner — the page only draws
 * this for those two, and the endpoint checks again. A plain PATCH against
 * `/api/stories/[id]`, so no new server surface: the same operation the
 * server-action form posts to, minus the round trip through a redirect.
 */
export function RenameStory({
  storyId,
  currentTitle,
}: {
  storyId: number;
  currentTitle: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentTitle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(currentTitle);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    const title = draft.trim();
    if (!title) {
      setError("Give it a name — even a short one.");
      return;
    }
    if (title === currentTitle) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/stories/${storyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        let message = "That did not go through. Try again.";
        try {
          message = (await res.json()).error ?? message;
        } catch {
          /* a non-JSON error body is not worth surfacing verbatim */
        }
        setError(message);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("The connection dropped. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="cursor-pointer rounded-chip border-[3px] border-transparent px-[11px] py-[3px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-3 hover:border-ink hover:bg-cream-2 hover:text-ink"
      >
        Rename
      </button>
    );
  }

  return (
    <div className="mt-[4px] max-w-[420px]">
      <label htmlFor={`rename-${storyId}`} className="sr-only">
        Ticket title
      </label>
      <div className="flex flex-wrap items-center gap-[8px]">
        <input
          id={`rename-${storyId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={120}
          disabled={saving}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-[200px] flex-1 rounded-card border-[3px] border-ink bg-porcelain px-[11px] py-[7px] text-[15px] text-ink"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || !draft.trim()}
          className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[15px] py-[7px] text-[13.5px] font-bold text-cream hover:bg-cherry disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="cursor-pointer rounded-chip border-[3px] border-transparent px-[11px] py-[7px] text-[13.5px] font-bold text-ink-2 hover:border-ink hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="mt-[8px]">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
    </div>
  );
}
