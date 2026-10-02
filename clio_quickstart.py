"""
Clio Manage API quickstart (read-only). Python 3.8+, standard library only.

1. Set your app's credentials in a .env file next to this script:
     CLIO_CLIENT_ID=your app key
     CLIO_CLIENT_SECRET=your app secret
   Optional:
     CLIO_REDIRECT_URI=http://localhost:3000/callback   # must match the app exactly
     CLIO_BASE=https://app.clio.com                     # eu.app.clio.com / ca.app.clio.com / au.app.clio.com
   Real environment variables (e.g. $env:CLIO_CLIENT_ID=...) override .env.

2. Run:  python clio_quickstart.py
   First run opens your browser -> click Approve -> token is saved to .clio_token.json.
   Later runs reuse (and refresh) the saved token.

Keep .clio_token.json and your secret OUT of git (add them to .gitignore).
"""
import json
import os
import secrets
import sys
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer


def _load_dotenv(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")):
    """Load KEY=VALUE lines from .env into os.environ (existing env vars win)."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_dotenv()

CLIENT_ID = os.environ.get("CLIO_CLIENT_ID")
CLIENT_SECRET = os.environ.get("CLIO_CLIENT_SECRET")
REDIRECT_URI = os.environ.get("CLIO_REDIRECT_URI", "http://localhost:3000/callback")
BASE = os.environ.get("CLIO_BASE", "https://app.clio.com").rstrip("/")
API = f"{BASE}/api/v4"
TOKEN_FILE = ".clio_token.json"


# ---------- OAuth ----------

def _post_token(data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(f"{BASE}/oauth/token", data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as r:
        tok = json.load(r)
    tok["obtained_at"] = int(time.time())
    with open(TOKEN_FILE, "w") as f:
        json.dump(tok, f, indent=2)
    return tok


def _authorize_in_browser():
    state = secrets.token_urlsafe(16)
    url = f"{BASE}/oauth/authorize?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "state": state,
    })
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in q or "error" in q:
                result.update({k: v[0] for k, v in q.items()})
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<h2>Clio connected. You can close this tab.</h2>")
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *a):
            pass

    parsed = urllib.parse.urlparse(REDIRECT_URI)
    server = HTTPServer((parsed.hostname, parsed.port or 80), Handler)
    print("Opening browser to approve access...\nIf it doesn't open, visit:\n" + url)
    webbrowser.open(url)
    while not result:
        server.handle_request()
    server.server_close()

    if "error" in result:
        sys.exit(f"Authorization failed: {result}")
    if result.get("state") != state:
        sys.exit("State mismatch - aborting. "
                 + ("Clio returned no state." if "state" not in result
                    else "That approval came from an older authorize link; use the newest one."))
    return _post_token({
        "grant_type": "authorization_code",
        "code": result["code"],
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
    })


def get_token():
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            tok = json.load(f)
        expires = tok.get("obtained_at", 0) + tok.get("expires_in", 0) - 60
        if time.time() < expires:
            return tok["access_token"]
        if tok.get("refresh_token"):
            try:
                new = _post_token({
                    "grant_type": "refresh_token",
                    "refresh_token": tok["refresh_token"],
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                })
                new.setdefault("refresh_token", tok["refresh_token"])
                with open(TOKEN_FILE, "w") as f:
                    json.dump(new, f, indent=2)
                return new["access_token"]
            except Exception as e:
                print("Refresh failed, re-authorizing:", e)
    return _authorize_in_browser()["access_token"]


# ---------- Read-only API helpers ----------

def get(path, token, **params):
    """GET one page. path like '/matters.json'."""
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def get_all(path, token, **params):
    """GET every page, following meta.paging.next."""
    params.setdefault("limit", 200)
    page = get(path, token, **params)
    rows = list(page.get("data", []))
    nxt = page.get("meta", {}).get("paging", {}).get("next")
    while nxt:
        req = urllib.request.Request(nxt, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req) as r:
            page = json.load(r)
        rows += page.get("data", [])
        nxt = page.get("meta", {}).get("paging", {}).get("next")
    return rows


if __name__ == "__main__":
    if not CLIENT_ID or not CLIENT_SECRET:
        sys.exit("Set CLIO_CLIENT_ID and CLIO_CLIENT_SECRET first (see top of file).")

    token = get_token()

    me = get("/users/who_am_i.json", token, fields="id,name,email")["data"]
    print(f"\nConnected as {me['name']} ({me['email']})")

    matters = get_all("/matters.json", token,
                      fields="id,display_number,description,status,open_date,"
                             "client{name},practice_area{name},matter_stage{name}")
    print(f"\n{len(matters)} matter(s):")
    for m in matters:
        print(f"  [{m['id']}] {m['display_number']} - {m['description']} "
              f"({(m.get('matter_stage') or {}).get('name')})")

    if matters:
        mid = matters[0]["id"]
        counts = {
            "notes": get_all("/notes.json", token, matter_id=mid, type="Matter", fields="id"),
            "communications": get_all("/communications.json", token, matter_id=mid, fields="id"),
            "tasks": get_all("/tasks.json", token, matter_id=mid, fields="id"),
            "calendar_entries": get_all("/calendar_entries.json", token, matter_id=mid, fields="id"),
            "documents": get_all("/documents.json", token, matter_id=mid, fields="id"),
        }
        print(f"\nFor matter {mid}:")
        for k, v in counts.items():
            print(f"  {k}: {len(v)}")