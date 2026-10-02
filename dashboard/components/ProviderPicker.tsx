"use client";

import { useRouter } from "next/navigation";

export function ProviderPicker({ providers, current }: { providers: { id: number; name: string; role: string }[]; current: number }) {
  const router = useRouter();
  return (
    <label className="grid gap-1 text-[13px] font-medium text-muted">
      Viewing as
      <select
        id="provider-picker"
        value={current}
        onChange={(e) => router.push(`/provider?provider=${e.target.value}`)}
        className="max-w-full rounded-lg border border-line bg-surface px-3 py-2 text-[15px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-med"
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
