"""
Turn the raw Clio pull (data/raw/*.json, from explore_clio.py) into one normalized file
the dashboards read: dashboard/data/case.json.

Every value carries a `source` saying which Clio record and field it came from, and every
event carries an `audience` ("legal" or "both") so the provider dashboard can leave out
attorney-only material. Each source also lists the passages in the case PDFs that support it
(`source.pdf`, best match first; see pdf_text.py).

Run:  python build_dashboard_data.py
"""
import html
import json
import os
import re
from datetime import datetime, timezone

import pdf_text

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")
OUT = os.path.join(HERE, "dashboard", "data", "case.json")

# Custom fields only lawyers should see (strategy, valuation, coverage, credibility).
LEGAL_FACTS = {
    "Liability Assessment", "Case Value Rationale", "Estimated Case Value", "Policy Limits",
    "Policy Limits Confirmed", "Prior Related Injuries", "Wage Loss Claimed", "Insurance Carrier",
    "Claim Number", "Health Insurance or Lien Holder", "Medical Specials To Date",
}

# Key moments in the case, matched against event titles: (event kind, pattern, label).
MILESTONES = [
    ("calendar", r"^Initial client consultation", "Firm retained"),
    ("calendar", r"^Left shoulder arthroscopy", "Surgery: left shoulder"),
    ("note", r"^No-fault exhausted", "No-fault benefits exhausted"),
    ("note", r"^Demand package served", "Demand sent to insurer"),
    ("document", r"summons-complaint", "Lawsuit filed"),
    ("note", r"^Second surgery recommended", "Second surgery recommended"),
    ("note", r"^Discovery served both ways", "Discovery under way"),
    ("calendar", r"^Compliance conference", "Court compliance conference"),
    ("calendar", r"^LIMITATIONS DATE", "Statute of limitations date"),
    ("calendar", r"^Orthopedic IME", "Defense medical exam (orthopedic)"),
    ("calendar", r"^Neurological IME", "Defense medical exam (neurological)"),
]

# Key moments in the patient's treatment, for the provider dashboard. Only matched against
# events providers are allowed to see.
MEDICAL_MILESTONES = [
    ("milestone", r"^Car crash", "Injury"),
    ("charge", r"Montefiore Nyack", "Emergency room visit"),
    ("calendar", r"^Pre-operative consultation", "Pre-op consultation"),
    ("calendar", r"^Left shoulder arthroscopy", "Surgery: left shoulder"),
    ("calendar", r"^Post-operative follow-up", "Post-op follow-up"),
    ("calendar", r"^Consultation re second surgery", "Right shoulder surgery recommended"),
    ("calendar", r"^Client treatment: chiropractic", "Ongoing chiropractic and PT"),
    ("calendar", r"^Call to McCulloch Orthopaedic re right shoulder", "Right shoulder surgery date requested"),
]

CORP_SUFFIX =re.compile(r",?\s+(PLLC|P\.C\.|LLC|Inc\.?)$")


def load(name):
    path = os.path.join(RAW, f"{name}.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)["data"]


def text(s):
    return html.unescape(s or "").strip()


def src(kind, record_id, field, label, endpoint, quote="", must_contain=""):
    """Where a value came from: shown in the dashboard's source viewer. `quote` is the record's
    text and `must_contain` a term the supporting PDF passage must include (a bill's amount).
    Both are used only to find that passage and are not written to case.json."""
    return {"kind": kind, "recordId": record_id, "field": field, "label": label,
            "api": f"GET /api/v4/{endpoint}/{record_id}.json", "_quote": quote, "_must": must_contain}


def money(s):
    return float(s.replace(",", "")) if s else None


# ---------- Parties ----------

def categorize(description, is_client):
    if is_client:
        return "client"
    d = description.lower()
    if "adverse" in d:
        return "adverse"
    if "carrier" in d or "claims administrator" in d:
        return "insurer"
    if any(w in d for w in ("provider", "hospital", "treating", "surgeon")):
        return "medical"
    return "other"


def aliases_for(contact, description):
    """Names a provider is referred to by in free text (tasks, charges, file names)."""
    name = contact["name"]
    out = {name, CORP_SUFFIX.sub("", name)}
    if contact["type"] == "Person":
        out.add(f"Dr. {contact['last_name']}")
    else:
        out.add(" ".join(CORP_SUFFIX.sub("", name).split()[:2]))
    # "(Kevin M. Haggerty, D.C.)" -> the practitioner behind a practice.
    for person in re.findall(r"\(([^()]+?),\s*(?:D\.C\.|M\.D\.)\)", description):
        out.update({person, person.split()[-1]})
    for other in re.findall(r"\(also ([^)]+)\)", description):
        out.add(" ".join(other.split()[:2]))
    return sorted(out, key=len, reverse=True)


def build_parties(matter):
    contacts = {c["id"]: c for c in load("contacts")}
    parties = []
    for r in load("relationships"):
        c = contacts.get(r["contact"]["id"], r["contact"])
        category = categorize(r["description"], c.get("is_client"))
        parties.append({
            "id": c["id"], "name": c["name"], "type": c["type"], "category": category,
            "role": text(r["description"]) if category != "client" else "Client",
            "email": c.get("primary_email_address"), "phone": c.get("primary_phone_number"),
            "address": ", ".join(filter(None, [(c.get("primary_address") or {}).get(k) for k in ("street", "city", "province")])),
            "aliases": aliases_for(c, r["description"]) if category == "medical" else [],
            "source": src("relationship", r["id"], "description", f"Relationship: {c['name']}", "relationships", f"{c['name']} {text(r['description'])}"),
            "contactSource": src("contact", c["id"], "name", f"Contact: {c['name']}", "contacts", c["name"]),
        })
    return parties


def match_providers(s, providers):
    hay = (s or "").lower().replace("-", " ").replace("_", " ")
    return [p["id"] for p in providers if any(a.lower() in hay for a in p["aliases"])]


# ---------- Facts ----------

def build_facts(matter):
    facts = []
    for v in sorted(matter["custom_field_values"], key=lambda v: v["field_display_order"]):
        name = v["field_name"]
        value = v["value"] if v["field_type"] in ("currency", "checkbox") else text(str(v["value"]))
        facts.append({
            "name": name, "type": v["field_type"], "value": value,
            "audience": "legal" if name in LEGAL_FACTS else "both",
            "source": src("custom_field", matter["id"], f"custom_field_values[{name}]", f"Matter custom field: {name}", "matters",
                          name if v["field_type"] == "checkbox" else str(value)),
        })
    by = {f["name"]: f for f in facts}

    def derived(key, label, value, from_field, audience):
        f = by.get(from_field)
        return {"key": key, "label": label, "value": value, "audience": audience,
                "source": f["source"] if f else None}

    limits = by.get("Policy Limits", {}).get("value", "")
    liens = by.get("Health Insurance or Lien Holder", {}).get("value", "")
    wage = by.get("Wage Loss Claimed", {}).get("value", "")
    lien = re.search(r"lien, \$([\d,.]+) asserted", liens)
    nofault = re.search(r"\$([\d,]+) basic economic loss exhausted", liens)
    numbers = [
        derived("specials", "Medical bills to date", by.get("Medical Specials To Date", {}).get("value"), "Medical Specials To Date", "legal"),
        derived("value", "Estimated case value", by.get("Estimated Case Value", {}).get("value"), "Estimated Case Value", "legal"),
        derived("defendantLimit", "Defendant's insurance limit", money((re.search(r"Defendant liability: \$([\d,]+)", limits) or [None, None])[1]), "Policy Limits", "legal"),
        derived("wageLoss", "Lost wages claimed", money((re.search(r"\$([\d,]+(?:\.\d\d)?) claimed", wage) or [None, None])[1]), "Wage Loss Claimed", "legal"),
        derived("lien", "Medicaid lien", money(lien[1]) if lien else None, "Health Insurance or Lien Holder", "both"),
        derived("noFault", "No-fault benefits (exhausted)", money(nofault[1]) if nofault else None, "Health Insurance or Lien Holder", "both"),
    ]
    return facts, numbers


# ---------- Events ----------

def doc_title(filename):
    stem = filename.rsplit(".", 1)[0].split("__")[-1].replace("-", " ")
    return stem[:1].upper() + stem[1:]


def build(matter):
    parties = build_parties(matter)
    providers = [p for p in parties if p["category"] == "medical"]
    kind_of = {p["id"]: p["category"] for p in parties}
    user_ids = {u["id"] for u in load("users")}
    facts, numbers = build_facts(matter)
    events, charges, costs, documents, tasks = [], [], [], [], []

    incident = next((f for f in facts if f["name"] == "Date of Incident"), None)
    if incident:
        events.append({"id": "incident", "kind": "milestone", "date": incident["value"], "title": "Car crash",
                       "body": next((f["value"] for f in facts if f["name"] == "Case Summary"), ""),
                       "audience": "both", "milestone": "Incident", "providerIds": [], "source": incident["source"]})

    for n in load("notes_matter"):
        events.append({"id": f"note-{n['id']}", "kind": "note", "date": n["date"], "title": text(n["subject"]),
                       "body": text(n["detail"]), "audience": "legal", "providerIds": [],
                       "source": src("note", n["id"], "subject, detail", f"Note: {text(n['subject'])}", "notes",
                                     f"{text(n['subject'])}\n{text(n['detail'])}")})

    for c in load("communications"):
        people = [p for p in c["senders"] + c["receivers"] if p["id"] not in user_ids]
        prov = [p["id"] for p in people if kind_of.get(p["id"]) == "medical"]
        outbound = bool(c["senders"]) and c["senders"][0]["id"] in user_ids
        sender = c["senders"][0]["name"] if c["senders"] else "Unknown"
        receiver = c["receivers"][0]["name"] if c["receivers"] else "Unknown"
        kind = "email" if c["type"] == "EmailCommunication" else "call"
        events.append({"id": f"comm-{c['id']}", "kind": kind, "date": c["date"], "title": text(c["subject"]),
                       "body": text(c["body"]), "from": sender, "to": receiver, "outbound": outbound,
                       "audience": "both" if prov else "legal", "providerIds": prov,
                       "counterpartIds": [p["id"] for p in people],
                       "source": src("communication", c["id"], "subject, body", f"{kind.title()}: {text(c['subject'])}", "communications",
                                     f"{text(c['subject'])}\n{text(c['body'])}")})

    medical_cal = re.compile(r"treatment:|arthroscopy|operative|Consultation re second surgery|McCulloch|Dr\. Capiola")
    legal_cal = re.compile(r"IME|conference|File review|LIMITATIONS|Client appointment|client consultation")
    for e in load("calendar_entries"):
        title = text(e["summary"])
        audience = "both" if medical_cal.search(title) and not legal_cal.search(title) else "legal"
        events.append({"id": f"cal-{e['id']}", "kind": "calendar", "date": e["start_date"], "start": e["start_at"],
                       "end": e["end_at"], "title": title, "body": text(e["description"]), "audience": audience,
                       "providerIds": match_providers(title + " " + (e["description"] or ""), providers) if audience == "both" else [],
                       "source": src("calendar_entry", e["id"], "summary, description", f"Calendar: {title}", "calendar_entries",
                                     f"{title}\n{text(e['description'])}")})

    for t in load("tasks"):
        title = text(t["name"])
        prov = match_providers(title + " " + t["description"], providers)
        is_request = title.startswith("By medical provider:")
        if is_request:
            title = "Records request: " + title.split(" - ", 1)[-1]
        task = {"id": f"task-{t['id']}", "kind": "task", "date": t["due_at"], "title": title, "body": text(t["description"]),
                "status": t["status"], "isRequest": is_request, "audience": "both" if prov else "legal", "providerIds": prov,
                "source": src("task", t["id"], "name, due_at, status", f"Task: {text(t['name'])}", "tasks",
                              f"{text(t['name'])}\n{text(t['description'])}")}
        events.append(task)
        tasks.append(task)

    for d in load("documents"):
        if not d.get("matter"):
            continue  # copies in the stray 00002 folder tree, not linked to the matter
        folder = d["parent"]["name"]
        medical = folder.startswith(("04", "05"))
        prov = match_providers(d["name"], providers)
        doc = {"id": f"doc-{d['id']}", "kind": "document", "date": d["received_at"][:10], "title": doc_title(d["name"]),
               "body": f"{d['name']} · {folder} · {d['size'] // 1024:,} KB", "folder": folder, "filename": d["name"],
               "size": d["size"], "audience": "both" if medical else "legal", "providerIds": prov,
               "source": src("document", d["id"], "name, received_at", f"Document: {d['name']}", "documents")}
        events.append(doc)
        documents.append(doc)

    seen = set()
    for a in load("activities"):
        note = text(a["note"])
        if a["non_billable"]:
            m = re.match(r".*?; (.+?); services (\S+) to (\S+); (.+?); (\S+\.pdf)", note)
            if not m:
                continue
            prov = match_providers(m[1], providers)
            charge = {"id": f"charge-{a['id']}", "kind": "charge", "date": a["date"], "providerId": prov[0] if prov else None,
                      "providerName": m[1], "amount": a["price"], "serviceStart": m[2], "serviceEnd": m[3],
                      "paymentStatus": m[4], "file": m[5],
                      "source": src("activity", a["id"], "note, price", f"Expense entry: {m[1]} charges", "activities",
                                    f"{m[1]} {a['price']:,.2f} {m[2]} {m[3]}", f"{a['price']:,.2f}")}
            charges.append(charge)
            events.append({"id": charge["id"], "kind": "charge", "date": a["date"], "title": f"Medical bill: {m[1]}",
                           "body": f"${a['price']:,.2f} for services {m[2]} to {m[3]}. Payment status: {m[4]}. Source bill: {m[5]}",
                           "amount": a["price"], "audience": "both", "providerIds": prov, "source": charge["source"]})
        else:
            key = (a["date"], a["price"], note[:40])
            if key in seen:
                continue  # the seed created some case costs twice
            seen.add(key)
            label, _, rest = note.partition(":")
            costs.append({"id": f"cost-{a['id']}", "date": a["date"], "amount": a["price"], "category": label,
                          "description": rest.strip().split("\n")[0],
                          "source": src("activity", a["id"], "note, price", f"Expense entry: {label}", "activities",
                                        f"{note} {a['price']:,.2f}", f"{a['price']:,.2f}")})

    for e in events:
        for kind, pattern, label in MILESTONES:
            if e["kind"] == kind and re.search(pattern, e.get("filename") or e["title"]):
                e["milestone"] = label
        if e["audience"] != "legal":
            for kind, pattern, label in MEDICAL_MILESTONES:
                if e["kind"] == kind and re.search(pattern, e["title"]):
                    e["medicalMilestone"] = label
    events.sort(key=lambda e: (e["date"], e["id"]))

    # Records requests: one per provider task, with the emails/calls to and from that provider.
    requests = []
    for t in tasks:
        if not t["providerIds"]:
            continue
        pid = t["providerIds"][0]
        comms = [e for e in events if e["kind"] in ("email", "call") and pid in e["providerIds"]]
        sent = [e for e in comms if e["outbound"]]
        replies = [e for e in comms if not e["outbound"]]
        requests.append({"taskId": t["id"], "providerId": pid, "title": t["title"], "detail": t["body"], "due": t["date"],
                         "status": t["status"], "timesAsked": len(sent), "lastAsked": sent[-1]["date"] if sent else None,
                         "lastReply": replies[-1]["date"] if replies else None,
                         "lastReplyId": replies[-1]["id"] if replies else None, "source": t["source"]})

    stages = sorted((s for s in load("matter_stages") if s["practice_area_id"] == matter["practice_area"]["id"]), key=lambda s: s["order"])
    sol = matter.get("statute_of_limitations") or {}
    sol_event = next((e for e in events if e.get("milestone") == "Statute of limitations date"), None)
    client = matter["client"]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pulledAt": datetime.fromtimestamp(os.path.getmtime(os.path.join(RAW, "_summary.json")), timezone.utc).isoformat(timespec="seconds"),
        "clioBase": os.environ.get("CLIO_BASE", "https://app.clio.com").rstrip("/"),
        "matter": {
            "id": matter["id"], "displayNumber": matter["display_number"], "description": text(matter["description"]),
            "status": matter["status"], "openDate": matter["open_date"], "practiceArea": matter["practice_area"]["name"],
            "stage": matter["matter_stage"]["name"], "stages": [s["name"] for s in stages],
            "responsibleAttorney": (matter.get("responsible_attorney") or {}).get("name"),
            "client": {"id": client["id"], "name": client["name"], "dob": client.get("date_of_birth"),
                       "email": client.get("primary_email_address"), "phone": client.get("primary_phone_number")},
            "sol": {"status": sol.get("status"), "description": text(sol.get("description")),
                    "date": sol_event["date"] if sol_event else None,
                    "source": src("task", sol["id"], "statute_of_limitations", "Matter: statute of limitations task", "tasks",
                                  text(sol.get("description"))) if sol else None},
            "source": src("matter", matter["id"], "display_number, matter_stage, practice_area", f"Matter {matter['display_number']}", "matters",
                          text(matter["description"])),
            "clientSource": src("contact", client["id"], "name, date_of_birth", f"Contact: {client['name']}", "contacts",
                                f"{client['name']} {client.get('date_of_birth') or ''}"),
        },
        "facts": facts, "numbers": numbers, "parties": parties, "events": events, "charges": charges,
        "costs": costs, "documents": documents, "requests": requests,
    }


# ---------- PDF passages ----------

def cite_pdfs(data):
    """Give every source the passages in the case PDFs that support it, best first. A document's
    own source opens that document at page one. Uses the PDFs explore_clio.py downloaded."""
    files, by_name = {}, {}
    for d in load("documents"):
        if os.path.exists(os.path.join(pdf_text.DOCS, f"{d['id']}.pdf")):
            files[d["id"]] = d
            by_name[d["name"]] = d["id"]
    pages = pdf_text.load_documents(files)
    finder = pdf_text.PassageFinder(pages, {doc_id: doc_title(d["name"]) for doc_id, d in files.items()})

    def cite(doc_id, page, rects=(), passage=""):
        w, h = pages[doc_id][page - 1]["w"], pages[doc_id][page - 1]["h"]
        name = files[doc_id]["name"]
        return {"doc": doc_id, "name": name, "title": doc_title(name), "folder": files[doc_id]["parent"]["name"],
                "page": page, "pages": len(pages[doc_id]), "size": [w, h], "rects": list(rects), "text": passage}

    # Names of the people and companies on the case appear all through the file, so a passage that
    # only shares a name does not support a note, bill or appointment. They still count for the
    # contact and relationship records the names belong to.
    names = {tuple(pdf_text.tokens(n)) for p in data["parties"] for n in [p["name"], *p.get("aliases", [])]}
    names.add(tuple(pdf_text.tokens(data["matter"]["client"]["name"])))
    names.discard(())

    def attach(source):
        quote = source.pop("_quote", "")
        must = source.pop("_must", "")
        if "pdf" in source:
            return
        if source["kind"] == "document":
            doc_id = source["recordId"] if source["recordId"] in files else by_name.get(source["label"].split(": ", 1)[-1])
            if doc_id in files:
                source["pdf"] = [cite(doc_id, 1)]
            return
        ignore = frozenset() if source["kind"] in ("contact", "relationship") else names
        require = set(pdf_text.tokens(must)) if must else None
        hits = finder.find(quote, ignore=ignore, require=require) if quote else []
        if hits:
            source["pdf"] = [cite(h["doc"], h["page"], h["rects"], h["text"]) for h in hits]

    # A medical bill names the itemized bill it was entered from; when that PDF is on file, cite it,
    # at the page that best matches the amount and dates.
    for charge in data["charges"]:
        doc_id = by_name.get(charge["file"])
        if doc_id is not None:
            quote = charge["source"].pop("_quote", "")
            charge["source"].pop("_must", "")
            hit = (finder.find(quote, ignore=names, doc_ids={doc_id}, limit=1, accept_any=True) or [None])[0]
            charge["source"]["pdf"] = [cite(doc_id, hit["page"], hit["rects"], hit["text"]) if hit else cite(doc_id, 1)]

    seen = set()

    def visit(node):
        if isinstance(node, list):
            for n in node:
                visit(n)
        elif isinstance(node, dict):
            if "api" in node and "recordId" in node and "kind" in node:
                if id(node) not in seen:  # facts and the numbers derived from them share a source
                    seen.add(id(node))
                    attach(node)
                return
            for v in node.values():
                visit(v)

    visit(data)
    return len(files), sum(1 for _ in seen), sum(1 for e in data["events"] if e["source"].get("pdf"))


def main():
    matters = load("matters")
    if not matters:
        raise SystemExit("No matters in data/raw. Run explore_clio.py first.")
    data = build(matters[0])
    n_docs, n_sources, n_events = cite_pdfs(data)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    print(f"Wrote {OUT}: {len(data['events'])} events, {len(data['charges'])} charges, "
          f"{len(data['documents'])} documents, {len(data['requests'])} records requests, "
          f"{n_events} events traced to a passage in {n_docs} PDFs")


if __name__ == "__main__":
    main()
