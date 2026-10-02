"""
Pull every dashboard-relevant Clio resource with ALL available fields and save raw JSON.

Clio only returns `id`/`etag` unless you name fields, so the field list for each
resource is built from Clio's published OpenAPI spec (cached in data/).

Run:  python explore_clio.py        (uses the token saved by clio_quickstart.py)
Output: data/raw/<resource>.json and data/raw/_summary.json, plus every case PDF in
        dashboard/data/documents/<document id>.pdf  (both folders are git-ignored)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from clio_quickstart import API, get_token

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
RAW = os.path.join(DATA, "raw")
SPEC_URL = "https://docs.developers.clio.com/openapi.json"
SPEC_FILE = os.path.join(DATA, "clio_openapi.json")
DOCS = os.path.join(HERE, "dashboard", "data", "documents")

# (output name, endpoint path, extra query params)
ENDPOINTS = [
    ("users", "/users.json", {}),
    ("matters", "/matters.json", {}),
    ("contacts", "/contacts.json", {}),
    ("relationships", "/relationships.json", {}),
    ("notes_matter", "/notes.json", {"type": "Matter"}),
    ("notes_contact", "/notes.json", {"type": "Contact"}),
    ("communications", "/communications.json", {}),
    ("conversations", "/conversations.json", {}),
    ("tasks", "/tasks.json", {}),
    ("task_types", "/task_types.json", {}),
    ("calendar_entries", "/calendar_entries.json", {}),
    ("calendars", "/calendars.json", {}),
    ("calendar_entry_event_types", "/calendar_entry_event_types.json", {}),
    ("documents", "/documents.json", {}),
    ("folders", "/folders.json", {}),
    ("document_categories", "/document_categories.json", {}),
    ("activities", "/activities.json", {}),
    ("activity_descriptions", "/activity_descriptions.json", {}),
    ("expense_categories", "/expense_categories.json", {}),
    ("bills", "/bills.json", {}),
    ("line_items", "/line_items.json", {}),
    ("medical_records_details", "/medical_records_details.json", {}),
    ("damages", "/damages.json", {}),
    ("custom_fields", "/custom_fields.json", {}),
    ("custom_field_sets", "/custom_field_sets.json", {}),
    ("matter_stages", "/matter_stages.json", {}),
    ("practice_areas", "/practice_areas.json", {}),
    ("reminders", "/reminders.json", {}),
    ("comments", "/comments.json", {}),
    ("outstanding_client_balances", "/outstanding_client_balances.json", {}),
    ("trust_line_items", "/trust_line_items.json", {}),
    ("matter_dockets", "/court_rules/matter_dockets.json", {}),
    ("groups", "/groups.json", {}),
]


# ---------- Field lists from the OpenAPI spec ----------

def load_spec():
    if not os.path.exists(SPEC_FILE):
        print("Downloading Clio OpenAPI spec...")
        urllib.request.urlretrieve(SPEC_URL, SPEC_FILE)
    with open(SPEC_FILE, encoding="utf-8") as f:
        return json.load(f)


def _ref_name(obj):
    """Return the schema name an object points at (directly or via array items), else None."""
    if "$ref" in obj:
        return obj["$ref"].rsplit("/", 1)[-1]
    if obj.get("type") == "array" and "$ref" in obj.get("items", {}):
        return obj["items"]["$ref"].rsplit("/", 1)[-1]
    return None


def _props(schemas, name):
    sch = schemas[name]
    props = dict(sch.get("properties", {}))
    for part in sch.get("allOf", []):
        if "$ref" in part:
            props.update(_props(schemas, part["$ref"].rsplit("/", 1)[-1]))
        props.update(part.get("properties", {}))
    return props


def build_fields(schemas, name, depth):
    """Clio `fields` string: scalars plus nested{...} for related records, `depth` levels deep."""
    parts = []
    for field, spec in _props(schemas, name).items():
        ref = _ref_name(spec)
        if ref is None:
            parts.append(field)
        elif depth > 0:
            sub = build_fields(schemas, ref, depth - 1)
            if sub:
                parts.append(f"{field}{{{sub}}}")
    return ",".join(parts)


def item_schema(spec, path):
    """Schema name of one record returned by GET <path>."""
    content = spec["paths"][path]["get"]["responses"]["200"]["content"]
    list_name = _ref_name(next(iter(content.values()))["schema"])
    data = spec["components"]["schemas"][list_name].get("properties", {}).get("data")
    return _ref_name(data) if data else list_name


def split_top_level(fields):
    """Split 'a,b{c,d},e' into ['a', 'b{c,d}', 'e']."""
    out, depth, cur = [], 0, ""
    for ch in fields:
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        depth += ch == "{"
        depth -= ch == "}"
        cur += ch
    if cur:
        out.append(cur)
    return out


# ---------- HTTP ----------

class ApiError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status, self.body = status, body


def fetch(url, token):
    for _ in range(5):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", "30"))
                print(f"    rate limited, waiting {wait}s")
                time.sleep(wait)
                continue
            raise ApiError(e.code, body)
    raise ApiError(429, "rate limited too many times")


def fetch_all(path, token, params):
    url = f"{API}{path}?" + urllib.parse.urlencode({**params, "limit": 200})
    page = fetch(url, token)
    rows = list(page.get("data", []))
    nxt = page.get("meta", {}).get("paging", {}).get("next")
    while nxt:
        page = fetch(nxt, token)
        rows += page.get("data", [])
        nxt = page.get("meta", {}).get("paging", {}).get("next")
    return rows


def _flatten(part):
    """'a{b,c{d}}' -> 'a{b}' (keep only the scalar subfields)."""
    name, inner = part.split("{", 1)
    scalars = [p for p in split_top_level(inner[:-1]) if "{" not in p]
    return f"{name}{{{','.join(scalars)}}}" if scalars else None


def _accepts(path, token, params, fields):
    url = f"{API}{path}?" + urllib.parse.urlencode({**params, "fields": fields, "limit": 1})
    try:
        fetch(url, token)
        return True
    except ApiError as e:
        if e.status == 400:
            return False
        raise


def fetch_with_fields(path, token, params, fields):
    """Fetch all rows; if Clio rejects the field list, test fields one at a time and keep the
    ones it accepts (nested fields fall back to their scalar subfields). Returns
    (rows, fields_used, dropped)."""
    parts = split_top_level(fields)
    try:
        return fetch_all(path, token, {**params, "fields": fields}), parts, []
    except ApiError as e:
        if e.status != 400:
            raise

    scalars = [p for p in parts if "{" not in p]
    if _accepts(path, token, params, ",".join(scalars)):
        good, dropped = list(scalars), []
    else:
        good = [p for p in scalars if _accepts(path, token, params, p)]
        dropped = [p for p in scalars if p not in good]
    for part in (p for p in parts if "{" in p):
        for candidate in (part, _flatten(part)):
            if candidate and _accepts(path, token, params, "id," + candidate):
                good.append(candidate)
                break
        else:
            dropped.append(part)
    return fetch_all(path, token, {**params, "fields": ",".join(good)}), good, dropped


# ---------- Document files ----------

def download_documents(token):
    """Save each case PDF once (by file name, preferring the copy filed on the matter) to
    dashboard/data/documents/<id>.pdf. Files already downloaded at the right size are kept."""
    path = os.path.join(RAW, "documents.json")
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as f:
        docs = json.load(f)["data"]
    chosen = {}
    for d in sorted(docs, key=lambda d: not d.get("matter")):
        if d.get("content_type") == "application/pdf":
            chosen.setdefault(d["name"], d)
    os.makedirs(DOCS, exist_ok=True)
    fetched = 0
    for d in chosen.values():
        out = os.path.join(DOCS, f"{d['id']}.pdf")
        if os.path.exists(out) and os.path.getsize(out) == d["size"]:
            continue
        download(f"{API}/documents/{d['id']}/download", token, out)
        fetched += 1
    return fetched


def download(url, token, out):
    for _ in range(5):
        req = urllib.request.Request(url)
        # Not forwarded on the redirect to the file store, which rejects a second credential.
        req.add_unredirected_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req) as r, open(out + ".part", "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            os.replace(out + ".part", out)
            return
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise ApiError(e.code, e.read().decode("utf-8", "replace"))
            wait = int(e.headers.get("Retry-After", "30"))
            print(f"    rate limited, waiting {wait}s")
            time.sleep(wait)
    raise ApiError(429, "rate limited too many times")


def main():
    os.makedirs(RAW, exist_ok=True)
    spec = load_spec()
    schemas = spec["components"]["schemas"]
    token = get_token()

    summary = {}
    for name, path, params in ENDPOINTS:
        print(f"{name} ...", end=" ", flush=True)
        try:
            fields = build_fields(schemas, item_schema(spec, path), depth=2)
            rows, used, dropped = fetch_with_fields(path, token, params, fields)
        except ApiError as e:
            print(f"FAILED ({e})")
            summary[name] = {"path": path, "error": str(e)}
            continue
        with open(os.path.join(RAW, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump({"path": path, "params": params, "fields": used, "dropped_fields": dropped,
                       "count": len(rows), "data": rows}, f, indent=2, ensure_ascii=False)
        print(f"{len(rows)} rows" + (f" (dropped {len(dropped)} fields)" if dropped else ""))
        summary[name] = {"path": path, "count": len(rows), "dropped_fields": dropped}

    # Messages live under each conversation.
    convs = os.path.join(RAW, "conversations.json")
    if os.path.exists(convs):
        with open(convs, encoding="utf-8") as f:
            conv_ids = [c["id"] for c in json.load(f)["data"]]
        if conv_ids:
            path = "/conversation_messages.json"
            fields = build_fields(schemas, item_schema(spec, path), depth=2)
            msgs = []
            for cid in conv_ids:
                rows, _, _ = fetch_with_fields(path, token, {"conversation_id": cid}, fields)
                msgs += rows
            with open(os.path.join(RAW, "conversation_messages.json"), "w", encoding="utf-8") as f:
                json.dump({"path": path, "count": len(msgs), "data": msgs}, f, indent=2, ensure_ascii=False)
            summary["conversation_messages"] = {"path": path, "count": len(msgs)}
            print(f"conversation_messages ... {len(msgs)} rows")

    print("document files ...", end=" ", flush=True)
    print(f"{download_documents(token)} downloaded")

    with open(os.path.join(RAW, "_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSaved to {RAW} and {DOCS}")


if __name__ == "__main__":
    sys.exit(main())
