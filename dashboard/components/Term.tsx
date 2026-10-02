// Plain-English definitions for legal and medical terms, so new team members can follow along.
const GLOSSARY = {
  specials: "Special damages: the client's out-of-pocket losses with a dollar figure, mainly medical bills. Here, the sum of every treating provider's bills.",
  sol: "Statute of limitations: the deadline to file the lawsuit. Miss it and the claim is lost.",
  lien: "A legal claim on the settlement. Medicaid paid some medical costs, so it gets repaid out of whatever the client recovers.",
  nofault: "New York no-fault insurance: the client's own car insurance pays the first $50,000 of medical bills and lost wages regardless of who caused the crash.",
  ime: "Independent medical examination: a doctor hired by the defense examines the client. Despite the name, it is the other side's expert.",
  watchdog: "A person from the client's side who attends the defense medical exam to observe and take notes.",
  discovery: "The pretrial stage where each side must hand over evidence: records, documents, and answers to written questions.",
  demand: "A formal letter to the insurer setting out the injuries and damages and asking for a settlement amount.",
  limits: "The most the insurance policy will pay. Here the defendant's limit is $100,000 per person, well below the case value.",
  compliance: "A court conference where the judge checks that both sides are meeting their discovery deadlines.",
  recordsRequest: "A written request from the law firm to a medical provider for treatment notes, bills or a surgical date, sent with the client's HIPAA authorization.",
  hipaa: "The client's signed permission for providers to release medical records to the law firm.",
  mmi: "Maximum medical improvement: the point where treatment is no longer expected to improve the condition.",
} as const;

export type TermId = keyof typeof GLOSSARY;

export function Term({ id, children }: { id: TermId; children: React.ReactNode }) {
  return (
    <span className="term" tabIndex={0}>
      {children}
      <span className="term-def" role="tooltip">
        {GLOSSARY[id]}
      </span>
    </span>
  );
}
