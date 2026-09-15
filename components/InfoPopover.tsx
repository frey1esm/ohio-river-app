"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Accessible disclosure for the longer explanatory text that used to sit
 * permanently under each card (source methodology notes, tributary
 * disclosures). Source name, observation time, and stale/unknown badges
 * stay visible on the card itself — only the lengthy prose moves here.
 */
export default function InfoPopover({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="info-popover" ref={wrapRef}>
      <button
        type="button"
        className="info-btn"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`More about ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <div id={panelId} role="tooltip" className="info-panel">
          {children}
        </div>
      )}
    </span>
  );
}
