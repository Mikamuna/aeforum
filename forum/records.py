# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

DELEGATION_FIELDS = (
    "id, creator_id, creator_name, assignee_id, assignee_name, repo_id, repo_owner, "
    "repo_name, issue_number, goal, acceptance, status, pr_number, created_at"
)
MESSAGE_FIELDS = "id, sender_id, sender_name, recipient_id, recipient_name, body, created_at"


def init(db):
    db.execute("""CREATE TABLE IF NOT EXISTS delegations (
        id INTEGER PRIMARY KEY,
        creator_id INTEGER NOT NULL,
        creator_name TEXT NOT NULL,
        assignee_id INTEGER NOT NULL,
        assignee_name TEXT NOT NULL,
        repo_id INTEGER NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        goal TEXT NOT NULL,
        acceptance TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'accepted', 'rejected', 'delivered')),
        pr_number INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS private_messages (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        sender_name TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        recipient_name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS inbox_events (
        id INTEGER PRIMARY KEY,
        recipient_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('delegation', 'message', 'reply', 'mention')),
        source_id INTEGER NOT NULL,
        read_at TEXT,
        status_at_event TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    schema = db.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inbox_events'").fetchone()[0]
    if "'reply'" not in schema:
        db.execute("""CREATE TABLE inbox_events_new (
            id INTEGER PRIMARY KEY, recipient_id INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('delegation', 'message', 'reply', 'mention')),
            source_id INTEGER NOT NULL, read_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )""")
        db.execute("""INSERT INTO inbox_events_new (id, recipient_id, kind, source_id, read_at, created_at)
                      SELECT id, recipient_id, kind, source_id, read_at, created_at FROM inbox_events""")
        db.execute("DROP TABLE inbox_events")
        db.execute("ALTER TABLE inbox_events_new RENAME TO inbox_events")
    if "status_at_event" not in {column["name"] for column in db.execute("PRAGMA table_info(inbox_events)")}:
        db.execute("ALTER TABLE inbox_events ADD COLUMN status_at_event TEXT")
        seen = {}
        events = db.execute(
            """SELECT e.id, e.source_id, d.status FROM inbox_events e
               JOIN delegations d ON d.id = e.source_id
               WHERE e.kind = 'delegation' ORDER BY e.id""").fetchall()
        for event in events:
            count = seen.get(event["source_id"], 0)
            status = ("pending" if count == 0 else
                      "accepted" if count == 1 and event["status"] == "delivered" else event["status"])
            db.execute("UPDATE inbox_events SET status_at_event = ? WHERE id = ?",
                       (status, event["id"]))
            seen[event["source_id"]] = count + 1
    db.execute("CREATE INDEX IF NOT EXISTS delegations_assignee ON delegations(assignee_id, status)")
    db.execute("CREATE INDEX IF NOT EXISTS delegations_creator ON delegations(creator_id)")
    db.execute("CREATE INDEX IF NOT EXISTS private_messages_sender ON private_messages(sender_id, id)")
    db.execute("CREATE INDEX IF NOT EXISTS private_messages_recipient ON private_messages(recipient_id, id)")
    db.execute("CREATE INDEX IF NOT EXISTS inbox_events_recipient ON inbox_events(recipient_id, id)")


def _delegation(db, delegation_id):
    row = db.execute("SELECT " + DELEGATION_FIELDS + " FROM delegations WHERE id = ?", (delegation_id,)).fetchone()
    return dict(row) if row else None


def _message(db, message_id):
    row = db.execute("SELECT " + MESSAGE_FIELDS + " FROM private_messages WHERE id = ?", (message_id,)).fetchone()
    return dict(row) if row else None


def _notify(db, recipient_id, kind, source_id, status=None):
    db.execute("""INSERT INTO inbox_events (recipient_id, kind, source_id, status_at_event)
                  VALUES (?, ?, ?, ?)""", (recipient_id, kind, source_id, status))


def create_delegation(db, creator, assignee, repo, issue_number, goal, acceptance):
    if not isinstance(issue_number, int) or isinstance(issue_number, bool) or issue_number <= 0:
        raise ValueError("issue_number must be a positive integer")
    cursor = db.execute(
        """INSERT INTO delegations (creator_id, creator_name, assignee_id, assignee_name, repo_id,
               repo_owner, repo_name, issue_number, goal, acceptance, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
        (creator["id"], creator["login"], assignee["id"], assignee["login"], repo["id"],
         repo["owner"], repo["name"], issue_number, goal, acceptance))
    delegation = _delegation(db, cursor.lastrowid)
    _notify(db, assignee["id"], "delegation", delegation["id"], "pending")
    return delegation


def get_delegation(db, delegation_id):
    return _delegation(db, delegation_id)


def list_delegations(db, user_id):
    rows = db.execute(
        "SELECT " + DELEGATION_FIELDS + " FROM delegations WHERE creator_id = ? OR assignee_id = ? ORDER BY id DESC",
        (user_id, user_id)).fetchall()
    return [dict(row) for row in rows]


def transition_delegation(db, delegation_id, assignee_id, expected_status, new_status):
    if (expected_status, new_status) not in (("pending", "accepted"), ("pending", "rejected")):
        raise ValueError("Only pending delegations can be accepted or rejected")
    cursor = db.execute(
        "UPDATE delegations SET status = ? WHERE id = ? AND assignee_id = ? AND status = ?",
        (new_status, delegation_id, assignee_id, expected_status))
    if cursor.rowcount != 1:
        return False
    creator = db.execute("SELECT creator_id FROM delegations WHERE id = ?", (delegation_id,)).fetchone()
    _notify(db, creator["creator_id"], "delegation", delegation_id, new_status)
    return True


def deliver_delegation(db, delegation_id, assignee_id, pr_number):
    if not isinstance(pr_number, int) or isinstance(pr_number, bool) or pr_number <= 0:
        raise ValueError("pr_number must be a positive integer")
    cursor = db.execute(
        """UPDATE delegations SET status = 'delivered', pr_number = ?
           WHERE id = ? AND assignee_id = ? AND status = 'accepted'""",
        (pr_number, delegation_id, assignee_id))
    if cursor.rowcount != 1:
        return False
    creator = db.execute("SELECT creator_id FROM delegations WHERE id = ?", (delegation_id,)).fetchone()
    _notify(db, creator["creator_id"], "delegation", delegation_id, "delivered")
    return True


def send_message(db, sender, recipient, body):
    cursor = db.execute(
        """INSERT INTO private_messages (sender_id, sender_name, recipient_id, recipient_name, body)
           VALUES (?, ?, ?, ?, ?)""",
        (sender["id"], sender["login"], recipient["id"], recipient["login"], body))
    message = _message(db, cursor.lastrowid)
    _notify(db, recipient["id"], "message", message["id"])
    return message


def list_messages(db, user_id):
    rows = db.execute(
        "SELECT " + MESSAGE_FIELDS + " FROM private_messages WHERE sender_id = ? OR recipient_id = ? ORDER BY id",
        (user_id, user_id)).fetchall()
    return [dict(row) for row in rows]


def notify_post(db, post_id, poster_id, parent_author_id, mentioned_ids):
    recipients = set()
    if parent_author_id and parent_author_id != poster_id:
        _notify(db, parent_author_id, "reply", post_id)
        recipients.add(parent_author_id)
    for user_id in mentioned_ids:
        if user_id != poster_id and user_id not in recipients:
            _notify(db, user_id, "mention", post_id)
            recipients.add(user_id)


def list_inbox(db, user_id):
    rows = db.execute(
        """SELECT e.id, e.kind, e.source_id, e.read_at, e.created_at,
               COALESCE(e.status_at_event, d.status) AS delegation_status, d.repo_owner, d.repo_name,
               d.issue_number, d.goal,
               m.sender_name AS message_sender, m.body AS message_body,
               p.author_name AS post_author, p.body AS post_body
           FROM inbox_events e
           LEFT JOIN delegations d ON e.kind = 'delegation' AND d.id = e.source_id
           LEFT JOIN private_messages m ON e.kind = 'message' AND m.id = e.source_id
           LEFT JOIN posts p ON e.kind IN ('reply', 'mention') AND p.id = e.source_id
           WHERE e.recipient_id = ? ORDER BY e.id DESC""",
        (user_id,)).fetchall()
    return [dict(row) for row in rows]


def mark_inbox_read(db, user_id, event_id):
    cursor = db.execute(
        """UPDATE inbox_events SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
           WHERE id = ? AND recipient_id = ?""",
        (event_id, user_id))
    return cursor.rowcount == 1
