# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

"""Independent A2A 1.0.0 HTTP+JSON Agent for the forum demo.

The Agent advertises exactly one skill: given one text part in the form
``owner/repo#number`` it returns the actual Gitea issue title and state. It
does not answer general questions or perform writes.

Security model:

* Requesters authenticate with their own Gitea personal access token as a
  standard HTTP Bearer credential (``Authorization: Bearer <PAT>``); the
  Gitea-native ``Authorization: token <PAT>`` form is also accepted. The
  caller must currently have read access to the requested repository.
* The Agent uses a separate dedicated ``A2A_AGENT_TOKEN`` belonging to
  ``A2A_AGENT_NAME`` (default ``demo-agent-a``). Every task re-verifies that
  this token still identifies that account and still has repository read.
* No Gitea site-administrator credential is read or required.

A2A tasks are stored in a separate SQLite database (``A2A_DB``) with UUID task
IDs. They are not forum delegations and are not linked to forum integer IDs.

Supported binding and operations:

* Agent Card at ``GET /.well-known/agent-card.json``
* ``POST /message:send`` (non-streaming, blocking bounded lookup)
* ``GET /tasks/{id}``
* ``GET /tasks``
* ``POST /tasks/{id}:cancel`` returns TaskNotCancelableError because lookups
  complete synchronously.
* Streaming, push notifications, extended Agent Cards, tenant path segments
  and multi-turn continuation are deliberately unsupported and return
  explicit A2A errors.
"""

import base64
import hashlib
import json
import logging
import os
import re
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlsplit

import gitea

PROTOCOL_VERSION = "1.0"
SKILL_ID = "summarize-gitea-issue"
MAX_BODY = 64 * 1024
MAX_HISTORY = 100
MAX_PAGE_SIZE = 100
TASK_ID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
REFERENCE_PATTERN = re.compile(r"^([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]{0,9})$")
NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
VERSION_PATTERN = re.compile(r"^([0-9]+)\.([0-9]+)(?:\.[0-9]+)?$")
TASK_STATES = frozenset({
    "TASK_STATE_UNSPECIFIED", "TASK_STATE_SUBMITTED", "TASK_STATE_WORKING",
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED",
    "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_REJECTED", "TASK_STATE_AUTH_REQUIRED",
})
TERMINAL_STATES = frozenset({
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED",
})
UPSTREAM_ERRORS = (HTTPError, URLError, OSError, KeyError, TypeError, ValueError)

log = logging.getLogger("a2a-peer")


def fail(message):
    print("a2a-peer: " + message, file=sys.stderr)
    raise SystemExit(2)


def load_config():
    agent_token = os.environ.get("A2A_AGENT_TOKEN", "").strip()
    if agent_token.lower().startswith("token "):
        agent_token = agent_token.split(" ", 1)[1].strip()
    if not agent_token or any(ch.isspace() for ch in agent_token):
        fail("A2A_AGENT_TOKEN must be the raw Gitea personal access token of the Agent account")

    agent_name = os.environ.get("A2A_AGENT_NAME", "demo-agent-a").strip()
    if not NAME_PATTERN.fullmatch(agent_name):
        fail("A2A_AGENT_NAME must be a Gitea login (letters, digits, dot, underscore, hyphen)")

    agent_version = os.environ.get("A2A_AGENT_VERSION", "1.0.0").strip()
    if not agent_version or len(agent_version) > 50:
        fail("A2A_AGENT_VERSION must be a short non-empty string")

    public_url = os.environ.get("A2A_PUBLIC_URL", "http://localhost:3002").strip()
    parsed = urlsplit(public_url)
    if (parsed.scheme not in ("http", "https") or not parsed.netloc
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        fail("A2A_PUBLIC_URL must be an absolute http(s) origin without a path, query or fragment")
    public_url = parsed.scheme + "://" + parsed.netloc

    gitea_public_url = os.environ.get("GITEA_PUBLIC_URL", "http://localhost:3000").strip().rstrip("/")
    parsed = urlsplit(gitea_public_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        fail("GITEA_PUBLIC_URL must be an absolute http(s) URL")

    try:
        port = int(os.environ.get("A2A_PORT", "3002"))
    except ValueError:
        fail("A2A_PORT must be an integer")
    if not 1 <= port <= 65535:
        fail("A2A_PORT must be between 1 and 65535")

    host = os.environ.get("A2A_HOST", "0.0.0.0").strip()
    if not host:
        fail("A2A_HOST must not be empty")

    db_path = os.environ.get("A2A_DB", "/data/a2a.sqlite3").strip()
    if not db_path:
        fail("A2A_DB must not be empty")

    gitea_url = urlsplit(gitea.GITEA_URL)
    if gitea_url.scheme not in ("http", "https") or not gitea_url.netloc:
        fail("GITEA_URL must be an absolute http(s) URL for the Gitea API")

    return {
        "agent_token": agent_token,
        "agent_name": agent_name,
        "agent_version": agent_version,
        "public_url": public_url,
        "gitea_public_url": gitea_public_url,
        "port": port,
        "host": host,
        "db_path": db_path,
    }


CONFIG = load_config()


def build_agent_card(config):
    description = (
        "Reads one actual Gitea issue from the demo Gitea instance at "
        + config["gitea_public_url"]
        + " and returns that issue's real current title and state. The caller's own "
        "Gitea account must currently have read access to the repository. This Agent "
        "does not answer general questions, does not read issue bodies, does not write "
        "to Gitea, and does not claim general reasoning. Requests outside the single "
        "advertised skill are rejected."
    )
    skill = {
        "id": SKILL_ID,
        "name": "Gitea issue title and state",
        "description": (
            "Given exactly one text part in the form owner/repo#number, reads that "
            "issue with the Agent's own Gitea credential and returns its actual title "
            "and state. Only issues in repositories the calling Gitea account can "
            "currently read are served. No general chat, issue-body summaries, code "
            "generation, writes, or pull-request operations are offered."
        ),
        "tags": ["gitea", "issue", "title", "state", "read-only"],
        "examples": ["owner/repo#1"],
        "inputModes": ["text/plain"],
        "outputModes": ["application/json", "text/plain"],
    }
    return {
        "name": config["agent_name"],
        "description": description,
        "supportedInterfaces": [{
            "url": config["public_url"],
            "protocolBinding": "HTTP+JSON",
            "protocolVersion": PROTOCOL_VERSION,
        }],
        "version": config["agent_version"],
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
            "extendedAgentCard": False,
        },
        "securitySchemes": {
            "giteaToken": {
                "httpAuthSecurityScheme": {
                    "scheme": "Bearer",
                    "bearerFormat": "Gitea personal access token",
                    "description": (
                        "Gitea personal access token for the calling account. Send "
                        "Authorization: Bearer <PAT>; the Gitea-native "
                        "Authorization: token <PAT> form is also accepted. The server "
                        "converts either form to the Gitea API token header and requires "
                        "current read access to the target repository."
                    ),
                }
            }
        },
        "securityRequirements": [{
            "schemes": {"giteaToken": {"list": []}},
        }],
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["application/json", "text/plain"],
        "skills": [skill],
    }


AGENT_CARD = build_agent_card(CONFIG)
CARD_BYTES = json.dumps(AGENT_CARD, ensure_ascii=False, sort_keys=True,
                        separators=(",", ":")).encode("utf-8")
CARD_ETAG = '"' + hashlib.sha256(CARD_BYTES).hexdigest() + '"'


class ProtocolError(Exception):
    def __init__(self, status, grpc_status, reason, message,
                 metadata=None, field_violations=None, allow=None):
        super().__init__(message)
        self.status = status
        self.grpc_status = grpc_status
        self.reason = reason
        self.message = message
        self.metadata = metadata
        self.field_violations = field_violations
        self.allow = allow


def invalid(field, description):
    return ProtocolError(
        400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "Invalid request parameters.",
        field_violations=[{"field": field, "description": description}])


def unsupported(message):
    return ProtocolError(400, "FAILED_PRECONDITION", "UNSUPPORTED_OPERATION", message)


def push_not_supported():
    return ProtocolError(
        400, "FAILED_PRECONDITION", "PUSH_NOTIFICATION_NOT_SUPPORTED",
        "Push notifications are not supported by this Agent.")


def upstream_unavailable():
    return ProtocolError(
        503, "UNAVAILABLE", "UNAVAILABLE",
        "Gitea is unavailable; retry later.")


def agent_unavailable():
    return ProtocolError(
        503, "UNAVAILABLE", "UNAVAILABLE",
        "The Agent credential is unavailable or lacks current read access to that repository.")


def has_control(value):
    return any(ord(ch) < 0x20 or ord(ch) == 0x7f for ch in value)


def canonical_time(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def iso_now():
    return canonical_time(datetime.now(timezone.utc))


def parse_timestamp(value, field):
    if not isinstance(value, str) or not value.strip():
        raise invalid(field, "Must be an ISO 8601 timestamp.")
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise invalid(field, "Must be an ISO 8601 timestamp.") from None
    if parsed.tzinfo is None:
        raise invalid(field, "Must include a UTC offset or Z.")
    return canonical_time(parsed)


@contextmanager
def database():
    db = sqlite3.connect(CONFIG["db_path"], timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout = 5000")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS a2a_tasks (
    id TEXT PRIMARY KEY,
    context_id TEXT NOT NULL,
    caller_id INTEGER NOT NULL,
    caller_login TEXT NOT NULL,
    repo_id INTEGER NOT NULL,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
        'TASK_STATE_UNSPECIFIED', 'TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING',
        'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED',
        'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_REJECTED', 'TASK_STATE_AUTH_REQUIRED'
    )),
    status_text TEXT,
    status_message_id TEXT NOT NULL,
    status_timestamp TEXT NOT NULL,
    request_message_id TEXT NOT NULL,
    request_text TEXT NOT NULL,
    artifact_json TEXT,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS a2a_tasks_caller_message
    ON a2a_tasks(caller_id, request_message_id);
CREATE INDEX IF NOT EXISTS a2a_tasks_caller_status
    ON a2a_tasks(caller_id, status_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS a2a_tasks_caller_context
    ON a2a_tasks(caller_id, context_id);
"""

TASK_FIELDS = (
    "id, context_id, caller_id, caller_login, repo_id, repo_owner, repo_name, "
    "issue_number, state, status_text, status_message_id, status_timestamp, "
    "request_message_id, request_text, artifact_json, created_at"
)


def initialize():
    directory = os.path.dirname(CONFIG["db_path"])
    if directory:
        os.makedirs(directory, exist_ok=True)
    with database() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(SCHEMA)
        interrupted = db.execute(
            "SELECT id, caller_id FROM a2a_tasks "
            "WHERE state IN ('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING')").fetchall()
        for row in interrupted:
            db.execute(
                "UPDATE a2a_tasks SET state = 'TASK_STATE_FAILED', status_text = ?, "
                "status_message_id = ?, status_timestamp = ? "
                "WHERE id = ? AND caller_id = ?",
                ("The Agent restarted before this task completed.",
                 str(uuid.uuid4()), iso_now(), row["id"], row["caller_id"]))
    if interrupted:
        log.warning("Marked %d interrupted A2A task(s) as failed", len(interrupted))


def load_task(task_id, caller_id):
    with database() as db:
        return db.execute(
            "SELECT " + TASK_FIELDS + " FROM a2a_tasks "
            "WHERE id = ? AND caller_id = ?", (task_id, caller_id)).fetchone()


def find_task_by_message(caller_id, message_id):
    with database() as db:
        return db.execute(
            "SELECT " + TASK_FIELDS + " FROM a2a_tasks "
            "WHERE caller_id = ? AND request_message_id = ?",
            (caller_id, message_id)).fetchone()


def create_task(caller, context_id, message_id, request_text, repo, issue_number):
    task_id = str(uuid.uuid4())
    now = iso_now()
    full_name = repo["owner"] + "/" + repo["name"]
    status_text = "Reading " + full_name + "#" + str(issue_number) + " with the Agent credential."
    with database() as db:
        row = db.execute(
            "SELECT " + TASK_FIELDS + " FROM a2a_tasks "
            "WHERE caller_id = ? AND request_message_id = ?",
            (caller["id"], message_id)).fetchone()
        if row is not None:
            return row, False
        try:
            db.execute(
                """INSERT INTO a2a_tasks (
                       id, context_id, caller_id, caller_login, repo_id, repo_owner,
                       repo_name, issue_number, state, status_text, status_message_id,
                       status_timestamp, request_message_id, request_text, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TASK_STATE_WORKING', ?, ?, ?, ?, ?, ?)""",
                (task_id, context_id, caller["id"], caller["login"], repo["id"],
                 repo["owner"], repo["name"], issue_number, status_text,
                 str(uuid.uuid4()), now, message_id, request_text, now))
        except sqlite3.IntegrityError:
            row = db.execute(
                "SELECT " + TASK_FIELDS + " FROM a2a_tasks "
                "WHERE caller_id = ? AND request_message_id = ?",
                (caller["id"], message_id)).fetchone()
            if row is None:
                raise
            return row, False
        row = db.execute(
            "SELECT " + TASK_FIELDS + " FROM a2a_tasks WHERE id = ?",
            (task_id,)).fetchone()
        return row, True


def finalize_task(task_id, caller_id, state, status_text, artifact=None):
    if state not in TERMINAL_STATES:
        raise ValueError("finalize_task requires a terminal state")
    artifact_json = None
    if artifact is not None:
        artifact_json = json.dumps(artifact, ensure_ascii=False, separators=(",", ":"))
    with database() as db:
        cursor = db.execute(
            "UPDATE a2a_tasks SET state = ?, status_text = ?, status_message_id = ?, "
            "status_timestamp = ?, artifact_json = ? WHERE id = ? AND caller_id = ?",
            (state, status_text, str(uuid.uuid4()), iso_now(), artifact_json,
             task_id, caller_id))
        if cursor.rowcount != 1:
            raise RuntimeError("Task disappeared during finalization")
        return db.execute(
            "SELECT " + TASK_FIELDS + " FROM a2a_tasks "
            "WHERE id = ? AND caller_id = ?", (task_id, caller_id)).fetchone()

def message_json(message_id, context_id, task_id, role, text):
    return {
        "messageId": message_id,
        "contextId": context_id,
        "taskId": task_id,
        "role": role,
        "parts": [{"text": text}],
    }


def status_message_json(row):
    if not row["status_text"]:
        return None
    return message_json(row["status_message_id"], row["context_id"], row["id"],
                        "ROLE_AGENT", row["status_text"])


def request_message_json(row):
    return message_json(row["request_message_id"], row["context_id"], row["id"],
                        "ROLE_USER", row["request_text"])


def task_json(row, history_length=None, include_artifacts=True):
    status_message = status_message_json(row)
    status = {"state": row["state"], "timestamp": row["status_timestamp"]}
    if status_message is not None:
        status["message"] = status_message
    task = {"id": row["id"], "contextId": row["context_id"], "status": status}
    if include_artifacts and row["artifact_json"]:
        task["artifacts"] = [json.loads(row["artifact_json"])]
    if history_length != 0:
        history = [request_message_json(row)]
        if status_message is not None:
            history.append(status_message)
        if history_length is None:
            task["history"] = history
        elif history_length > 0:
            task["history"] = history[-history_length:]
    task["metadata"] = {
        "skill": SKILL_ID,
        "repository": row["repo_owner"] + "/" + row["repo_name"],
        "issueNumber": row["issue_number"],
    }
    return task


def public_issue_url(repo, issue_number):
    return (CONFIG["gitea_public_url"] + "/" + quote(repo["owner"], safe="") + "/"
            + quote(repo["name"], safe="") + "/issues/" + str(issue_number))


def build_artifact(issue, repo, issue_number):
    if not isinstance(issue, dict):
        raise ValueError("issue is not an object")
    title = issue.get("title")
    state = issue.get("state")
    if not isinstance(title, str) or not isinstance(state, str) or not state:
        raise ValueError("issue lacks a title or state")
    if type(issue.get("number")) is not int or issue["number"] != issue_number:
        raise ValueError("issue number mismatch")
    state_reason = issue.get("state_reason")
    if state_reason is not None and not isinstance(state_reason, str):
        raise ValueError("issue state reason is not a string")
    full_name = repo["owner"] + "/" + repo["name"]
    retrieved_at = iso_now()
    data = {
        "repository": full_name,
        "number": issue_number,
        "title": title,
        "state": state,
        "url": public_issue_url(repo, issue_number),
        "retrievedAt": retrieved_at,
        "readBy": CONFIG["agent_name"],
    }
    if state_reason:
        data["stateReason"] = state_reason
    summary = full_name + "#" + str(issue_number) + ' "' + title + '" is ' + state + "."
    return {
        "artifactId": str(uuid.uuid4()),
        "name": "Gitea issue title and state",
        "description": (
            "Actual Gitea issue title and state for " + full_name + "#"
            + str(issue_number) + ", read with the Agent's own Gitea credential."),
        "parts": [
            {"text": summary},
            {"data": data, "mediaType": "application/json"},
        ],
    }


def parse_history_length(value, field):
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= MAX_HISTORY:
        raise invalid(field, "Must be an integer between 0 and " + str(MAX_HISTORY) + ".")
    return value


def query_one(query, name):
    values = query.get(name)
    if not values:
        return None
    if len(values) != 1:
        raise invalid(name, "Must be provided at most once.")
    return values[0]


def int_query(query, name, default, minimum, maximum):
    value = query_one(query, name)
    if value is None:
        return default
    if not re.fullmatch(r"[0-9]+", value):
        raise invalid(name, "Must be an integer between " + str(minimum)
                      + " and " + str(maximum) + ".")
    number = int(value)
    if not minimum <= number <= maximum:
        raise invalid(name, "Must be an integer between " + str(minimum)
                      + " and " + str(maximum) + ".")
    return number


def query_history_length(query):
    return int_query(query, "historyLength", None, 0, MAX_HISTORY)


def normalize_state(value):
    text = value.strip().upper()
    if not text.startswith("TASK_STATE_"):
        text = "TASK_STATE_" + text
    if text not in TASK_STATES:
        raise invalid("status", "Must be a TASK_STATE_* value.")
    return text


def parse_bool(value, field):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
    raise invalid(field, "Must be true or false.")


def encode_cursor(row):
    payload = json.dumps({"t": row["status_timestamp"], "i": row["id"]},
                         separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise invalid("pageToken", "Invalid page token.")
    padding = "=" * (-len(value) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(value + padding).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise invalid("pageToken", "Invalid page token.") from None
    if (not isinstance(payload, dict) or not isinstance(payload.get("t"), str)
            or not isinstance(payload.get("i"), str)):
        raise invalid("pageToken", "Invalid page token.")
    if not payload["i"] or len(payload["i"]) > 200 or has_control(payload["i"]):
        raise invalid("pageToken", "Invalid page token.")
    return {"t": parse_timestamp(payload["t"], "pageToken"), "i": payload["i"]}


def canonical_task_id(value):
    if not TASK_ID_PATTERN.fullmatch(value):
        raise invalid("id", "Must be a task UUID generated by this Agent.")
    return value.lower()

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "a2a-peer/" + PROTOCOL_VERSION
    sys_version = ""
    timeout = 30

    def log_message(self, fmt, *args):
        log.debug("%s - %s", self.client_address[0], fmt % args)

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_PATCH(self):
        self.dispatch()

    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = dict(headers or {})
        headers.setdefault("Content-Type", "application/json")
        headers.setdefault("Content-Length", str(len(body)))
        headers.setdefault("Cache-Control", "no-store")
        headers.setdefault("X-Content-Type-Options", "nosniff")
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass

    @staticmethod
    def etag_matches(value):
        for candidate in value.split(","):
            candidate = candidate.strip()
            if candidate.startswith("W/"):
                candidate = candidate[2:].strip()
            if candidate == CARD_ETAG:
                return True
        return False

    def send_card(self):
        if_none_match = self.headers.get("If-None-Match")
        if if_none_match and self.etag_matches(if_none_match):
            self.send_response(304)
            self.send_header("ETag", CARD_ETAG)
            self.send_header("Cache-Control", "public, max-age=300")
            self.send_header("Content-Length", "0")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(CARD_BYTES)))
        self.send_header("ETag", CARD_ETAG)
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(CARD_BYTES)
        except OSError:
            pass

    def send_error_payload(self, error):
        details = [{
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            "reason": error.reason,
            "domain": "a2a-protocol.org",
        }]
        if error.metadata:
            details[0]["metadata"] = error.metadata
        if error.field_violations:
            details.append({
                "@type": "type.googleapis.com/google.rpc.BadRequest",
                "fieldViolations": error.field_violations,
            })
        payload = {"error": {
            "code": error.status,
            "status": error.grpc_status,
            "message": error.message,
            "details": details,
        }}
        headers = {}
        if error.status == 401:
            headers["WWW-Authenticate"] = 'Bearer realm="a2a"'
        if error.allow:
            headers["Allow"] = error.allow
        log.info("%s %s -> %d %s", self.command, urlsplit(self.path).path,
                 error.status, error.reason)
        self.send_json(error.status, payload, headers)

    def dispatch(self):
        parsed = urlsplit(self.path)
        path = parsed.path
        if path != "/" and path.endswith("/"):
            path = path.rstrip("/")
        query = parse_qs(parsed.query, keep_blank_values=True)
        try:
            if path == "/.well-known/agent-card.json":
                if self.command != "GET":
                    raise ProtocolError(405, "METHOD_NOT_ALLOWED", "UNSUPPORTED_OPERATION",
                                        "Use GET for the Agent Card.", allow="GET")
                self.send_card()
                return
            if not (path == "/message:send" or path == "/message:stream"
                    or path == "/tasks" or path.startswith("/tasks/")
                    or path == "/extendedAgentCard"):
                raise ProtocolError(404, "NOT_FOUND", "NOT_FOUND", "No such A2A resource.")
            self.handle_operation(path, query)
        except ProtocolError as error:
            self.send_error_payload(error)
        except Exception:
            log.exception("Unhandled error for %s %s", self.command, path)
            self.send_error_payload(ProtocolError(
                500, "INTERNAL", "INTERNAL", "Internal error."))

    def handle_operation(self, path, query):
        user = self.authenticate()
        self.require_version(query)

        if path == "/message:stream":
            raise unsupported(
                "Streaming is not supported by this Agent; use POST /message:send "
                "and GET /tasks/{id}.")
        if path == "/extendedAgentCard":
            raise unsupported("An extended Agent Card is not configured for this Agent.")
        if path.startswith("/tasks/") and "/pushNotificationConfigs" in path:
            raise push_not_supported()
        if path == "/message:send":
            if self.command != "POST":
                raise ProtocolError(405, "METHOD_NOT_ALLOWED", "UNSUPPORTED_OPERATION",
                                    "Use POST for message:send.", allow="POST")
            self.handle_send(user, query)
            return
        if path == "/tasks":
            if self.command != "GET":
                raise ProtocolError(405, "METHOD_NOT_ALLOWED", "UNSUPPORTED_OPERATION",
                                    "Use GET for listing tasks.", allow="GET")
            self.handle_list(user, query)
            return
        match = re.fullmatch(r"/tasks/([^/]+):cancel", path)
        if match:
            if self.command != "POST":
                raise ProtocolError(405, "METHOD_NOT_ALLOWED", "UNSUPPORTED_OPERATION",
                                    "Use POST for tasks/{id}:cancel.", allow="POST")
            self.handle_cancel(user, unquote(match.group(1)))
            return
        if re.fullmatch(r"/tasks/([^/]+):subscribe", path):
            raise unsupported("Streaming subscriptions are not supported by this Agent.")
        if path.startswith("/tasks/") and ":" in path:
            raise ProtocolError(404, "NOT_FOUND", "NOT_FOUND", "No such A2A resource.")
        match = re.fullmatch(r"/tasks/([^/]+)", path)
        if match:
            if self.command != "GET":
                raise ProtocolError(405, "METHOD_NOT_ALLOWED", "UNSUPPORTED_OPERATION",
                                    "Use GET for tasks/{id}.", allow="GET")
            self.handle_get(user, query, unquote(match.group(1)))
            return
        raise ProtocolError(404, "NOT_FOUND", "NOT_FOUND", "No such A2A resource.")

    def authenticate(self):
        header = self.headers.get("Authorization", "")
        scheme, _, value = header.partition(" ")
        scheme = scheme.strip().lower()
        token = value.strip()
        if (scheme not in ("bearer", "token") or not token
                or any(ch.isspace() for ch in token)):
            log.warning("Rejected unauthenticated A2A request from %s",
                        self.client_address[0])
            raise ProtocolError(401, "UNAUTHENTICATED", "UNAUTHENTICATED",
                                "A Gitea personal access token is required.")
        try:
            user = gitea.request(token, "/user")
        except gitea.AccessDenied:
            log.warning("Rejected invalid Gitea caller token from %s",
                        self.client_address[0])
            raise ProtocolError(401, "UNAUTHENTICATED", "UNAUTHENTICATED",
                                "The Gitea personal access token was rejected.") from None
        except UPSTREAM_ERRORS:
            log.warning("Gitea caller authentication failed from %s",
                        self.client_address[0])
            raise upstream_unavailable() from None
        if (not isinstance(user, dict) or type(user.get("id")) is not int
                or not isinstance(user.get("login"), str)):
            log.error("Gitea returned an unexpected user payload")
            raise upstream_unavailable()
        return {"id": user["id"], "login": user["login"], "token": token}

    def require_version(self, query):
        value = self.headers.get("A2A-Version")
        if value is None:
            candidates = query.get("A2A-Version") or query.get("a2a-version")
            value = candidates[0] if candidates else None
        text = value.strip() if value is not None else ""
        match = VERSION_PATTERN.fullmatch(text)
        if not match or (match.group(1), match.group(2)) != ("1", "0"):
            raise ProtocolError(
                400, "FAILED_PRECONDITION", "VERSION_NOT_SUPPORTED",
                "Only A2A protocol version 1.0 is supported.",
                metadata={"requestedVersion": text or "0.3",
                          "supportedVersions": "1.0"})

    def read_json_body(self):
        content_type = self.headers.get("Content-Type", "")
        media_type = content_type.split(";", 1)[0].strip().lower()
        if media_type not in ("application/json", "application/a2a+json"):
            raise ProtocolError(
                400, "INVALID_ARGUMENT", "CONTENT_TYPE_NOT_SUPPORTED",
                "Content-Type must be application/json or application/a2a+json.")
        if self.headers.get("Transfer-Encoding", "").strip().lower() == "chunked":
            raise invalid("body", "Chunked request bodies are not supported.")
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise invalid("body", "Content-Length is required.")
        try:
            length = int(raw_length)
        except ValueError:
            raise invalid("body", "Content-Length must be an integer.") from None
        if length < 1:
            raise invalid("body", "A JSON object body is required.")
        if length > MAX_BODY:
            raise ProtocolError(413, "RESOURCE_EXHAUSTED", "RESOURCE_EXHAUSTED",
                                "Request body is too large.")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise invalid("body", "Request body was incomplete.")
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ProtocolError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT",
                                "Invalid JSON payload.") from None
        if not isinstance(body, dict):
            raise invalid("body", "The JSON payload must be an object.")
        return body

    @staticmethod
    def repository_for_token(token, full_name):
        try:
            return gitea.repository(token, full_name)
        except gitea.AccessDenied:
            raise ProtocolError(403, "PERMISSION_DENIED", "PERMISSION_DENIED",
                                "Current read access to that repository is required.") from None
        except UPSTREAM_ERRORS:
            raise upstream_unavailable() from None

    @staticmethod
    def has_current_repo_access(token, row):
        try:
            repo = gitea.repository(token, row["repo_owner"] + "/" + row["repo_name"])
        except gitea.AccessDenied:
            return False
        except UPSTREAM_ERRORS:
            raise upstream_unavailable() from None
        return repo["id"] == row["repo_id"] and bool(repo["permissions"].get("pull"))

    @staticmethod
    def verify_agent(full_name, caller_repo):
        try:
            agent_user = gitea.request(CONFIG["agent_token"], "/user")
        except gitea.AccessDenied:
            log.error("A2A_AGENT_TOKEN was rejected by Gitea")
            raise agent_unavailable() from None
        except UPSTREAM_ERRORS:
            log.error("A2A agent identity lookup failed")
            raise agent_unavailable() from None
        if (not isinstance(agent_user, dict) or not isinstance(agent_user.get("login"), str)
                or agent_user["login"].casefold() != CONFIG["agent_name"].casefold()):
            log.error("A2A_AGENT_TOKEN does not belong to %s", CONFIG["agent_name"])
            raise agent_unavailable()
        if agent_user.get("is_admin") is True:
            log.error("A2A_AGENT_TOKEN belongs to a Gitea site administrator; "
                      "a non-admin Agent account is required")
            raise agent_unavailable()
        try:
            agent_repo = gitea.repository(CONFIG["agent_token"], full_name)
        except gitea.AccessDenied:
            log.error("A2A agent lacks current read access to %s", full_name)
            raise agent_unavailable() from None
        except UPSTREAM_ERRORS:
            log.error("A2A agent repository lookup failed for %s", full_name)
            raise agent_unavailable() from None
        if agent_repo["id"] != caller_repo["id"]:
            log.error("A2A agent repository identity mismatch for %s", full_name)
            raise agent_unavailable()

    def handle_send(self, user, query):
        body = self.read_json_body()
        message = body.get("message")
        if not isinstance(message, dict):
            raise invalid("message", "A message object is required.")
        configuration = body.get("configuration", {})
        if configuration is None:
            configuration = {}
        if not isinstance(configuration, dict):
            raise invalid("configuration", "Must be an object.")
        if (configuration.get("taskPushNotificationConfig") is not None
                or configuration.get("pushNotificationConfig") is not None):
            raise push_not_supported()
        accepted = configuration.get("acceptedOutputModes")
        if accepted is not None:
            if not isinstance(accepted, list) or not all(
                    isinstance(item, str) for item in accepted):
                raise invalid("configuration.acceptedOutputModes",
                              "Must be an array of strings.")
            if accepted and not any(
                    item.split(";", 1)[0].strip().lower() in
                    ("application/json", "text/plain", "*/*", "application/*")
                    for item in accepted):
                raise ProtocolError(400, "INVALID_ARGUMENT", "CONTENT_TYPE_NOT_SUPPORTED",
                                    "This Agent returns application/json and text/plain.")
        history_length = parse_history_length(configuration.get("historyLength"),
                                               "configuration.historyLength")
        if not isinstance(configuration.get("returnImmediately", False), bool):
            raise invalid("configuration.returnImmediately", "Must be true or false.")

        message_id = message.get("messageId")
        if (not isinstance(message_id, str) or not 1 <= len(message_id.strip()) <= 200
                or has_control(message_id)):
            raise invalid("message.messageId",
                          "A non-empty messageId of at most 200 characters is required.")
        message_id = message_id.strip()
        if message.get("role") != "ROLE_USER":
            raise invalid("message.role", "Must be ROLE_USER.")

        task_ref = message.get("taskId")
        if task_ref is not None:
            if not isinstance(task_ref, str):
                raise invalid("message.taskId", "Must be a string.")
            task_ref = task_ref.strip() or None
            if task_ref is not None and (len(task_ref) > 200 or has_control(task_ref)):
                raise invalid("message.taskId", "At most 200 characters are allowed.")

        context_id = message.get("contextId")
        if context_id is not None:
            if not isinstance(context_id, str):
                raise invalid("message.contextId", "Must be a string.")
            context_id = context_id.strip() or None
            if context_id is not None and (len(context_id) > 200
                                           or has_control(context_id)):
                raise invalid("message.contextId", "At most 200 characters are allowed.")

        parts = message.get("parts")
        if not isinstance(parts, list) or not parts:
            raise invalid("message.parts", "At least one part is required.")
        texts = []
        for index, part in enumerate(parts):
            field = "message.parts[" + str(index) + "]"
            if not isinstance(part, dict):
                raise invalid(field, "Must be an object.")
            content = [key for key in ("text", "raw", "url", "data") if key in part]
            if len(content) != 1:
                raise invalid(field, "Exactly one of text, raw, url or data is required.")
            if content[0] != "text":
                raise ProtocolError(400, "INVALID_ARGUMENT", "CONTENT_TYPE_NOT_SUPPORTED",
                                    "Only text parts are supported by this skill.")
            text = part["text"]
            if not isinstance(text, str):
                raise invalid(field + ".text", "Must be a string.")
            media_type = part.get("mediaType")
            if media_type is not None:
                if not isinstance(media_type, str):
                    raise invalid(field + ".mediaType", "Must be a string.")
                if media_type.split(";", 1)[0].strip().lower() != "text/plain":
                    raise ProtocolError(400, "INVALID_ARGUMENT",
                                        "CONTENT_TYPE_NOT_SUPPORTED",
                                        "The skill accepts text/plain parts only.")
            texts.append(text)
        if len(texts) != 1:
            raise invalid("message.parts", "Exactly one text part is required.")
        reference = texts[0].strip()
        if len(reference) > 1000:
            raise invalid("message.parts[0].text", "The issue reference is too long.")
        match = REFERENCE_PATTERN.fullmatch(reference)
        if not match:
            raise invalid("message.parts[0].text",
                          "Expected one issue reference exactly as owner/repo#number.")
        owner, repo_name, number_text = match.groups()
        if owner in (".", "..") or repo_name in (".", ".."):
            raise invalid("message.parts[0].text", "Invalid repository name.")
        issue_number = int(number_text)

        if task_ref is not None:
            if TASK_ID_PATTERN.fullmatch(task_ref):
                task_ref = task_ref.lower()
            existing = load_task(task_ref, user["id"])
            if existing is None:
                raise ProtocolError(
                    404, "NOT_FOUND", "TASK_NOT_FOUND",
                    "The referenced task does not exist or is not accessible.",
                    metadata={"taskId": task_ref})
            raise unsupported(
                "Follow-up messages to an existing task are not supported by this Agent; "
                "send a new messageId to start a new task.")

        caller_repo = self.repository_for_token(user["token"], owner + "/" + repo_name)
        full_name = caller_repo["owner"] + "/" + caller_repo["name"]

        existing = find_task_by_message(user["id"], message_id)
        if existing is not None:
            if ((existing["repo_owner"], existing["repo_name"], existing["issue_number"],
                 existing["request_text"])
                    != (caller_repo["owner"], caller_repo["name"], issue_number, reference)):
                raise invalid("message.messageId",
                              "This messageId was already used for a different request.")
            if not self.has_current_repo_access(user["token"], existing):
                raise ProtocolError(403, "PERMISSION_DENIED", "PERMISSION_DENIED",
                                    "Current read access to the task's repository is "
                                    "required.")
            self.send_json(200, {"task": task_json(existing, history_length)})
            return

        self.verify_agent(full_name, caller_repo)

        row, created = create_task(user, context_id or str(uuid.uuid4()), message_id,
                                   reference, caller_repo, issue_number)
        if not created:
            if ((row["repo_owner"], row["repo_name"], row["issue_number"],
                 row["request_text"])
                    != (caller_repo["owner"], caller_repo["name"], issue_number, reference)):
                raise invalid("message.messageId",
                              "This messageId was already used for a different request.")
            if not self.has_current_repo_access(user["token"], row):
                raise ProtocolError(403, "PERMISSION_DENIED", "PERMISSION_DENIED",
                                    "Current read access to the task's repository is "
                                    "required.")
            self.send_json(200, {"task": task_json(row, history_length)})
            return

        log.info("Created A2A task %s for caller %s on %s#%d",
                 row["id"], user["login"], full_name, issue_number)
        issue_path = ("/repos/" + quote(caller_repo["owner"], safe="") + "/"
                      + quote(caller_repo["name"], safe="") + "/issues/"
                      + str(issue_number))
        try:
            issue = gitea.request(CONFIG["agent_token"], issue_path)
        except gitea.AccessDenied:
            log.warning("Issue %s#%d was not readable by the Agent",
                        full_name, issue_number)
            row = finalize_task(
                row["id"], user["id"], "TASK_STATE_FAILED",
                "Issue " + full_name + "#" + str(issue_number)
                + " was not found or is no longer readable by the Agent.")
        except UPSTREAM_ERRORS:
            log.warning("Issue lookup failed for %s#%d", full_name, issue_number)
            row = finalize_task(
                row["id"], user["id"], "TASK_STATE_FAILED",
                "The issue could not be read from Gitea; retry later.")
        else:
            if isinstance(issue, dict) and issue.get("pull_request") is not None:
                row = finalize_task(
                    row["id"], user["id"], "TASK_STATE_FAILED",
                    full_name + "#" + str(issue_number)
                    + " is a pull request; this skill only reads issues.")
            else:
                try:
                    artifact = build_artifact(issue, caller_repo, issue_number)
                except ValueError:
                    log.warning("Issue payload for %s#%d was unusable",
                                full_name, issue_number)
                    row = finalize_task(
                        row["id"], user["id"], "TASK_STATE_FAILED",
                        "Gitea returned the issue without a usable title and state.")
                else:
                    row = finalize_task(
                        row["id"], user["id"], "TASK_STATE_COMPLETED",
                        "Returned the current title and state of " + full_name + "#"
                        + str(issue_number) + ".", artifact)
        log.info("Finalized A2A task %s as %s", row["id"], row["state"])
        self.send_json(200, {"task": task_json(row, history_length)})

    def handle_get(self, user, query, task_id):
        task_id = canonical_task_id(task_id)
        history_length = query_history_length(query)
        row = load_task(task_id, user["id"])
        if row is None:
            raise ProtocolError(404, "NOT_FOUND", "TASK_NOT_FOUND",
                                "The task does not exist or is not accessible.",
                                metadata={"taskId": task_id})
        if not self.has_current_repo_access(user["token"], row):
            raise ProtocolError(403, "PERMISSION_DENIED", "PERMISSION_DENIED",
                                "Current read access to the task's repository is required.")
        self.send_json(200, task_json(row, history_length))

    def handle_list(self, user, query):
        context_id = query_one(query, "contextId")
        if context_id is not None:
            if not context_id or len(context_id) > 200 or has_control(context_id):
                raise invalid("contextId",
                              "Must be a non-empty string of at most 200 characters.")
        status_value = query_one(query, "status")
        state = None
        if status_value not in (None, ""):
            state = normalize_state(status_value)
        page_size = int_query(query, "pageSize", 50, 1, MAX_PAGE_SIZE)
        page_token = query_one(query, "pageToken")
        cursor = decode_cursor(page_token) if page_token not in (None, "") else None
        history_length = query_history_length(query)
        after_value = query_one(query, "statusTimestampAfter")
        after = None
        if after_value not in (None, ""):
            after = parse_timestamp(after_value, "statusTimestampAfter")
        include_value = query_one(query, "includeArtifacts")
        include_artifacts = False
        if include_value not in (None, ""):
            include_artifacts = parse_bool(include_value, "includeArtifacts")

        sql = "SELECT " + TASK_FIELDS + " FROM a2a_tasks WHERE caller_id = ?"
        arguments = [user["id"]]
        if context_id is not None:
            sql += " AND context_id = ?"
            arguments.append(context_id)
        if state is not None:
            sql += " AND state = ?"
            arguments.append(state)
        if after is not None:
            sql += " AND status_timestamp >= ?"
            arguments.append(after)
        sql += " ORDER BY status_timestamp DESC, id DESC"
        with database() as db:
            rows = db.execute(sql, arguments).fetchall()

        visible = []
        access = {}
        for row in rows:
            key = (row["repo_id"], row["repo_owner"], row["repo_name"])
            if key not in access:
                access[key] = self.has_current_repo_access(user["token"], row)
            if access[key]:
                visible.append(row)
        total_size = len(visible)
        if cursor is not None:
            visible = [row for row in visible
                       if (row["status_timestamp"], row["id"])
                       < (cursor["t"], cursor["i"])]
        page = visible[:page_size]
        next_page_token = encode_cursor(page[-1]) if len(visible) > page_size else ""
        tasks = [task_json(row, history_length, include_artifacts) for row in page]
        self.send_json(200, {
            "tasks": tasks,
            "nextPageToken": next_page_token,
            "pageSize": page_size,
            "totalSize": total_size,
        })

    def handle_cancel(self, user, task_id):
        task_id = canonical_task_id(task_id)
        row = load_task(task_id, user["id"])
        if row is None:
            raise ProtocolError(404, "NOT_FOUND", "TASK_NOT_FOUND",
                                "The task does not exist or is not accessible.",
                                metadata={"taskId": task_id})
        if not self.has_current_repo_access(user["token"], row):
            raise ProtocolError(403, "PERMISSION_DENIED", "PERMISSION_DENIED",
                                "Current read access to the task's repository is required.")
        raise ProtocolError(
            400, "FAILED_PRECONDITION", "TASK_NOT_CANCELABLE",
            "Task is not cancelable: this Agent completes each bounded lookup "
            "synchronously and does not support cancellation.",
            metadata={"taskId": task_id, "state": row["state"]})


def configure_logging():
    level_name = os.environ.get("A2A_LOG_LEVEL", "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(level=level, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(message)s")


def main():
    configure_logging()
    initialize()
    server = ThreadingHTTPServer((CONFIG["host"], CONFIG["port"]), Handler)
    server.daemon_threads = True
    log.info("A2A %s Agent %s listening on %s:%d", PROTOCOL_VERSION,
             CONFIG["agent_name"], CONFIG["host"], CONFIG["port"])
    log.info("Agent Card: %s/.well-known/agent-card.json", CONFIG["public_url"])
    log.info("A2A task database: %s", CONFIG["db_path"])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Stopping A2A Agent")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
