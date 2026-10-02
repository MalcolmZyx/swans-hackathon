"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Bottom sheet (DESIGN.md §6.4). Sheets stack; Esc or the backdrop closes the top one and focus
 * returns to whatever opened it.
 */

const stack: string[] = [];

export function Sheet({ chip, title, onClose, wide = false, z = 50, children, footer }: { chip: React.ReactNode; title: React.ReactNode; onClose: () => void; wide?: boolean; z?: number; children: React.ReactNode; footer?: React.ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    stack.push(id);
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack.at(-1) === id) {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [id]);

  return (
    <div className="fixed inset-0 flex items-end justify-center" style={{ zIndex: z }}>
      <div className="sheet-backdrop absolute inset-0 bg-[rgba(14,23,38,.32)]" onClick={() => onClose()} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
        className="sheet relative flex max-h-[88vh] w-full flex-col rounded-t-[20px] bg-surface shadow-lg outline-none max-[760px]:max-h-[92vh]"
        style={{ maxWidth: wide ? 1040 : 720 }}
      >
        <div className="flex items-center gap-3 border-b border-line-2 px-5 py-3.5">
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 ring-1 ring-line">{chip}</span>
          <h2 id={`${id}-t`} className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="btn sm shrink-0" aria-label="Close">
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer}
      </div>
    </div>
  );
}
