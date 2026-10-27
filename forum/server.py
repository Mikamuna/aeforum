# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

import gitea
import records
import work

DB_PATH = os.environ.get("FORUM_DB", "/data/forum.sqlite3")
WEB_ROOT = Path(__file__).parent / "web" / "dist"
SESSION_COOKIE = "forum_session"
COOKIE_FLAGS = "; HttpOnly; SameSite=Strict; Path=/forum"
if os.environ.get("FORUM_HTTPS") == "1":
    COOKIE_FLAGS += "; Secure"

SESSIONS = {}


def connect():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES posts(id),
            author_id INTEGER NOT NULL, author_name TEXT NOT NULL,
            body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS posts_parent_id ON posts(parent_id, id)")
        records.init(db)
        work.init(db)

def positive(value, name):
    if type(value) is not int or value <= 0:
        raise ValueError(name + " must be a positive integer")
    return value


def content(value, name, maximum=4000):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum:
        raise ValueError(name + " must contain 1–" + str(maximum) + " characters")
    return value.strip()


def repo_for(token, delegation, write=False):
    full_name = delegation["repo_owner"] + "/" + delegation["repo_name"]
    repo = gitea.repository(token, full_name, write)
    if repo["id"] != delegation["repo_id"]:
        raise gitea.AccessDenied()
    return repo


def visible_delegations(db, user, token):
    result = []
    for delegation in records.list_delegations(db, user["id"]):
        try:
            repo_for(token, delegation)
            result.append(delegation)
        except gitea.AccessDenied:
            pass
    return result


def visible_inbox(db, user, token):
    result = []
    for event in records.list_inbox(db, user["id"]):
        if event["kind"] in ("message", "reply", "mention"):
            result.append(event)
            continue
        delegation = records.get_delegation(db, event["source_id"])
        if delegation:
            try:
                repo_for(token, delegation)
                result.append(event)
            except gitea.AccessDenied:
                pass
    return result


def delegation_for(db, user, token, delegation_id):
    delegation = records.get_delegation(db, delegation_id)
    if not delegation or user["id"] not in (delegation["creator_id"], delegation["assignee_id"]):
        raise gitea.AccessDenied()
    repo_for(token, delegation)
    return delegation


def list_posts(token):
    with connect() as db:
        posts = [dict(row) for row in db.execute(
            "SELECT id, parent_id, author_id, author_name, body, created_at FROM posts ORDER BY id")]
        references = work.references(db, [post["id"] for post in posts])
    for post in posts:
        reference = references.get(post["id"])
        if reference:
            try:
                repo = repo_for(token, reference)
                gitea.reference(token, repo, reference["kind"], reference["number"])
                post["reference"] = reference
            except gitea.AccessDenied:
                pass
    return posts


def resolve_reference(token, reference):
    if reference is None:
        return None
    if not isinstance(reference, dict):
        raise ValueError("reference must be an object")
    kind = reference.get("kind")
    if kind not in ("repo", "issue", "pr"):
        raise ValueError("reference.kind must be repo, issue, or pr")
    repo = gitea.repository(token, reference.get("repo"))
    number = reference.get("number")
    if kind != "repo":
        number = positive(number, "reference.number")
    elif number is not None:
        raise ValueError("Repository reference must omit number")
    gitea.reference(token, repo, kind, number)
    return repo, kind, number


def visible_listings(db, token):
    result = []
    for listing in work.list_listings(db):
        try:
            repo = repo_for(token, listing)
            gitea.issue(token, repo, listing["issue_number"])
            result.append(listing)
        except gitea.AccessDenied:
            pass
    return result


def publish(user, token, body, parent_id=None, reference=None):
    body = content(body, "Content")
    mentioned_ids = []
    for name in dict.fromkeys(re.findall(r"(?<![A-Za-z0-9_.-])@([A-Za-z0-9][A-Za-z0-9_.-]{0,38})", body)):
        try:
            mentioned_ids.append(gitea.account(token, name)["id"])
        except gitea.AccessDenied:
            pass
    with connect() as db:
        parent_author_id = None
        if parent_id is not None:
            parent = db.execute("SELECT parent_id, author_id FROM posts WHERE id = ?", (parent_id,)).fetchone()
            if parent is None or parent["parent_id"] is not None:
                raise ValueError("Replies must target an existing top-level post")
            parent_author_id = parent["author_id"]
        cursor = db.execute("INSERT INTO posts (parent_id, author_id, author_name, body) VALUES (?, ?, ?, ?)",
                            (parent_id, user["id"], user["login"], body))
        if reference:
            work.add_reference(db, cursor.lastrowid, *reference)
        records.notify_post(db, cursor.lastrowid, user["id"], parent_author_id, mentioned_ids)
        return cursor.lastrowid


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, data, content_type="application/json", cookies=None):
        if content_type == "application/json":
            data = json.dumps(data, ensure_ascii=False).encode()
        elif isinstance(data, str):
            data = data.encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        for cookie in (cookies if isinstance(cookies, (list, tuple)) else [cookies] if cookies else []):
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 8192:
            raise ValueError("Request body must contain 1–8192 bytes")
        return self.rfile.read(size)

    def session(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        key = cookies.get(SESSION_COOKIE)
        return SESSIONS.get(key.value) if key else None

    def api_token(self):
        authorization = self.headers.get("Authorization", "")
        if authorization.lower().startswith("token "):
            return authorization[6:].strip()
        return ""

    def authenticated(self, mutation=False):
        authorization = self.headers.get("Authorization", "")
        if authorization:
            token = self.api_token()
            return gitea.identity(token), token
        session = self.valid_session()
        if not session:
            return None, ""
        if mutation and not secrets.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf"]):
            raise PermissionError("Invalid CSRF token")
        return session["user"], session["token"]

    def session_response(self, session):
        return {"user": session["user"], "csrf": session["csrf"]}

    def valid_session(self):
        session = self.session()
        if session:
            user = gitea.identity(session["token"])
            if user and user["id"] == session["user"]["id"]:
                return session
        return None

    def json_body(self):
        data = json.loads(self.body())
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object")
        return data

    def static(self, path):
        if path == "/" or path in ("/inbox", "/delegations", "/listings", "/messages", "/discussion", "/login"):
            target = WEB_ROOT / "index.html"
        elif path.startswith("/assets/"):
            target = (WEB_ROOT / path.lstrip("/")).resolve()
            if not target.is_relative_to(WEB_ROOT.resolve()):
                return self.respond(404, {"error": "Not found"})
        else:
            return self.respond(404, {"error": "Not found"})
        if not target.is_file():
            return self.respond(404, {"error": "Frontend assets missing"})
        return self.respond(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream")

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            if path == "/health":
                return self.respond(200, {"status": "ok"})
            if not path.startswith("/api/"):
                return self.static(path)
            if path == "/api/session":
                session = self.valid_session()
                return self.respond(200, self.session_response(session)) if session else self.respond(401, {"error": "Sign in required"})
            user, token = self.authenticated()
            if not user:
                return self.respond(401, {"error": "Valid Gitea token required"})
            if path == "/api/posts":
                return self.respond(200, list_posts(token))
            if path == "/api/me":
                return self.respond(200, {**user, "repositories": gitea.my_repositories(token)})
            with connect() as db:
                if path == "/api/listings":
                    return self.respond(200, visible_listings(db, token))
                if path == "/api/delegations":
                    return self.respond(200, visible_delegations(db, user, token))
                if path.startswith("/api/delegations/") and len(path.split("/")) == 4:
                    delegation = delegation_for(db, user, token, positive(int(path.rsplit("/", 1)[1]), "id"))
                    return self.respond(200, delegation)
                if path == "/api/inbox":
                    return self.respond(200, visible_inbox(db, user, token))
                if path == "/api/messages":
                    return self.respond(200, records.list_messages(db, user["id"]))
            return self.respond(404, {"error": "Not found"})
        except gitea.AccessDenied:
            self.respond(403, {"error": "Gitea resource access denied"})
        except (ValueError, TypeError) as error:
            self.respond(400, {"error": str(error)})
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.respond(502, {"error": "Gitea service unavailable"})
            self.log_error("Gitea request failed: %s", error)

    def create_delegation(self, user, token, data):
        repo = gitea.repository(token, data.get("repo"), write=True)
        number = positive(data.get("issue_number"), "issue_number")
        gitea.issue(token, repo, number)
        assignee = gitea.account(token, data.get("assignee"))
        if assignee["id"] == user["id"]:
            raise ValueError("Assignee must be a separate account")
        goal = content(data.get("goal"), "goal")
        acceptance = content(data.get("acceptance"), "acceptance")
        with connect() as db:
            return records.create_delegation(db, user, assignee, repo, number, goal, acceptance)
    def create_listing(self, user, token, data):
        repo = gitea.repository(token, data.get("repo"), write=True)
        number = positive(data.get("issue_number"), "issue_number")
        gitea.issue(token, repo, number)
        description = content(data.get("description"), "description")
        with connect() as db:
            return work.create_listing(db, user, repo, number, description)


    def change_delegation(self, user, token, delegation_id, action, data=None):
        with connect() as db:
            delegation = delegation_for(db, user, token, delegation_id)
            if user["id"] != delegation["assignee_id"]:
                raise gitea.AccessDenied()
            if action == "deliver":
                if delegation["status"] != "accepted":
                    return None
                repo = repo_for(token, delegation, write=True)
                number = positive(data.get("pr_number"), "pr_number")
                gitea.pull_request(token, repo, number, user["id"])
                changed = records.deliver_delegation(db, delegation_id, user["id"], number)
            else:
                changed = records.transition_delegation(db, delegation_id, user["id"], "pending",
                                                        "accepted" if action == "accept" else "rejected")
            return records.get_delegation(db, delegation_id) if changed else None

    def send_message(self, user, token, data):
        recipient = gitea.account(token, data.get("recipient"))
        body = content(data.get("body"), "body")
        with connect() as db:
            return records.send_message(db, user, recipient, body)

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            if path == "/api/session":
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                    return self.respond(415, {"error": "JSON content type required"})
                origin = self.headers.get("Origin")
                if origin and origin != self.headers.get("X-Forwarded-Proto", "http") + "://" + self.headers.get("Host", ""):
                    return self.respond(403, {"error": "Origin mismatch"})
                token = self.json_body().get("token", "")
                if not isinstance(token, str):
                    raise ValueError("token must be a string")
                token = token.strip()
                user = gitea.identity(token)
                if not user:
                    return self.respond(401, {"error": "Invalid Gitea token"})
                key = secrets.token_urlsafe(32)
                session = {"user": user, "token": token, "csrf": secrets.token_urlsafe(32)}
                SESSIONS[key] = session
                return self.respond(200, self.session_response(session), cookies=[
                    SESSION_COOKIE + "=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
                    SESSION_COOKIE + "=" + key + COOKIE_FLAGS,
                ])
            if path == "/api/logout":
                session = self.valid_session()
                if not session:
                    return self.respond(401, {"error": "Sign in required"})
                if not secrets.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf"]):
                    return self.respond(403, {"error": "Invalid CSRF token"})
                cookie = SimpleCookie()
                cookie.load(self.headers.get("Cookie", ""))
                if SESSION_COOKIE in cookie:
                    SESSIONS.pop(cookie[SESSION_COOKIE].value, None)
                return self.respond(200, {"signed_out": True}, cookies=SESSION_COOKIE + "=" + COOKIE_FLAGS + "; Max-Age=0")
            if path.startswith("/api/"):
                user, token = self.authenticated(mutation=True)
                if not user:
                    return self.respond(401, {"error": "Valid Gitea token required"})
                if path == "/api/posts":
                    data = self.json_body()
                    parent_id = data.get("parent_id")
                    if parent_id is not None:
                        positive(parent_id, "parent_id")
                    reference = resolve_reference(token, data.get("reference"))
                    return self.respond(201, {"id": publish(user, token, data.get("body", ""), parent_id, reference)})
                if path == "/api/listings":
                    return self.respond(201, self.create_listing(user, token, self.json_body()))
                if path == "/api/delegations":
                    return self.respond(201, self.create_delegation(user, token, self.json_body()))
                if path == "/api/messages":
                    return self.respond(201, self.send_message(user, token, self.json_body()))
                parts = path.split("/")
                if len(parts) == 5 and parts[1:3] == ["api", "delegations"] and parts[4] in ("accept", "reject", "deliver"):
                    delegation_id = positive(int(parts[3]), "id")
                    data = self.json_body() if parts[4] == "deliver" else None
                    result = self.change_delegation(user, token, delegation_id, parts[4], data)
                    return self.respond(200, result) if result else self.respond(409, {"error": "Delegation state changed"})
                if len(parts) == 5 and parts[1:3] == ["api", "inbox"] and parts[4] == "read":
                    event_id = positive(int(parts[3]), "id")
                    with connect() as db:
                        if event_id not in {event["id"] for event in visible_inbox(db, user, token)}:
                            raise gitea.AccessDenied()
                        records.mark_inbox_read(db, user["id"], event_id)
                    return self.respond(200, {"id": event_id, "read": True})
                return self.respond(404, {"error": "Not found"})
            return self.respond(404, {"error": "Not found"})
        except PermissionError as error:
            self.respond(403, {"error": str(error)})
        except gitea.AccessDenied:
            self.respond(403, {"error": "Gitea resource access denied"})
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.respond(400, {"error": str(error)})
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            self.respond(502, {"error": "Gitea service unavailable"})
            self.log_error("Gitea request failed: %s", error)

if __name__ == "__main__":
    initialize()
    ThreadingHTTPServer(("0.0.0.0", 3001), Handler).serve_forever()
