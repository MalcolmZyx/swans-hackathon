import type { Metadata } from "next";
import { headers } from "next/headers";
import { DoctorUpdate } from "@/components/DoctorUpdate";
import { loadCase, today } from "@/lib/data";
import { doctorView, expiresAt, openShare } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadCase();
  return { title: data ? `${data.matter.client.name} · Patient update` : "Patient update", robots: { index: false, follow: false } };
}

function Unavailable({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 text-center font-inter">
      <div className="grid justify-items-center gap-2">
        <span className="text-[40px] leading-none text-[#98A1B1]">○</span>
        <h1 className="text-[20px] font-bold">{title}</h1>
        <p className="max-w-[300px] text-[15px] text-[#6B7485]">{text}</p>
      </div>
    </div>
  );
}

// The doctor's page (DESIGN.md §6.9): no login, the unguessable token is the key, every open is logged.
export default async function PatientUpdate({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const data = await loadCase();
  const share = data ? await openShare(token, (await headers()).get("user-agent") ?? "") : null;
  let body: React.ReactNode;
  if (!data || !share || share.matterId !== data.matter.id) {
    body = <Unavailable title="This link isn't available" text="This link is no longer active. Contact the firm for a new one." />;
  } else {
    const view = await doctorView(data, share.providerId, share.policy, share.note, today(), expiresAt(share));
    body = <DoctorUpdate view={view} token={token} following={share.following} />;
  }
  return (
    <div className="min-h-screen bg-[#F6F7F9] min-[520px]:py-10">
      <div className="mx-auto max-w-[480px] px-4 py-5 min-[520px]:rounded-[28px] min-[520px]:bg-[#F6F7F9] min-[520px]:shadow-[0_30px_80px_-20px_rgba(14,23,38,.3)]">{body}</div>
    </div>
  );
}
