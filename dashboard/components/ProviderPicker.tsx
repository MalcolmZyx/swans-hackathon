"use client";

import { useRouter } from "next/navigation";

export function ProviderPicker({ providers, current }: { providers: { id: number; name: string; role: string }[]; current: number }) {
  const router = useRouter();
  return (
    <label className="grid gap-1.5">
      <span className="label">Viewing as</span>
      <select
        id="provider-picker"
        value={current}
        onChange={(e) => {
          // Keep the open tab (?tab=) when switching providers.
          const params = new URLSearchParams(window.location.search);
          params.set("provider", e.target.value);
          router.push(`/provider?${params}`);
        }}
        className="h-[42px] max-w-full rounded-[11px] border border-line bg-surface px-3 text-[15px] font-semibold text-ink shadow-soft hover:border-[#d3d7de] focus-visible:outline-2 focus-visible:outline-accent"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
