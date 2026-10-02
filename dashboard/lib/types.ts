// Shape of data/case.json, written by build_dashboard_data.py.

export type Audience = "legal" | "both";

export type Source = {
  kind: "matter" | "contact" | "relationship" | "custom_field" | "note" | "communication" | "calendar_entry" | "task" | "document" | "activity";
  recordId: number | string;
  field: string;
  label: string;
  api: string;
  href?: string; // added by lib/data.ts
};

export type EventKind = "milestone" | "note" | "email" | "call" | "calendar" | "task" | "document" | "charge";

export type CaseEvent = {
  id: string;
  kind: EventKind;
  date: string;
  title: string;
  body: string;
  audience: Audience;
  providerIds: number[];
  milestone?: string; // key moment in the legal case
  medicalMilestone?: string; // key moment in the patient's treatment
  status?: "pending" | "complete";
  isRequest?: boolean;
  from?: string;
  to?: string;
  outbound?: boolean;
  start?: string;
  end?: string;
  folder?: string;
  amount?: number;
  source: Source;
};

export type Fact = { name: string; type: string; value: string | number | boolean; audience: Audience; source: Source };
export type KeyNumber = { key: string; label: string; value: number | null; audience: Audience; source: Source | null };

export type Party = {
  id: number;
  name: string;
  type: "Person" | "Company";
  category: "client" | "adverse" | "insurer" | "medical" | "other";
  role: string;
  email: string | null;
  phone: string | null;
  address: string;
  source: Source;
  contactSource: Source;
};

export type Charge = {
  id: string;
  date: string;
  providerId: number | null;
  providerName: string;
  amount: number;
  serviceStart: string;
  serviceEnd: string;
  paymentStatus: string;
  file: string;
  source: Source;
};

export type Cost = { id: string; date: string; amount: number; category: string; description: string; source: Source };

export type RecordsRequest = {
  taskId: string;
  providerId: number;
  title: string;
  detail: string;
  due: string;
  status: "pending" | "complete";
  timesAsked: number;
  lastAsked: string | null;
  lastReply: string | null;
  lastReplyId: string | null;
  source: Source;
};

export type Matter = {
  id: number;
  displayNumber: string;
  description: string;
  status: string;
  openDate: string;
  practiceArea: string;
  stage: string;
  stages: string[];
  responsibleAttorney: string | null;
  client: { id: number; name: string; dob: string | null; email: string | null; phone: string | null };
  sol: { status: string; description: string; date: string | null; source: Source | null };
  source: Source;
  clientSource: Source;
};

// Shape of data/brief.json, written by lib/brief.ts on each Refresh from Clio.

/** One point in the AI brief. `sources` are record ids (see sourceIndex in lib/brief.ts). */
export type BriefPoint = { label?: string; text: string; sources: string[] };

export type Brief = {
  generatedAt: string;
  model: string;
  pulledAt: string; // the Clio pull this brief describes
  since: string | null; // the pull the user last saw ("last sign-in"); null on the first one
  changeCount: number;
  headline: string;
  whatsNew: BriefPoint[];
  overview: BriefPoint[];
};

export type CaseData = {
  generatedAt: string;
  pulledAt: string;
  clioBase: string;
  matter: Matter;
  facts: Fact[];
  numbers: KeyNumber[];
  parties: Party[];
  events: CaseEvent[];
  charges: Charge[];
  costs: Cost[];
  documents: CaseEvent[];
  requests: RecordsRequest[];
};
