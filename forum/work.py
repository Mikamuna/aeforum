# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

import sqlite3

REFERENCE_FIELDS = "post_id, repo_id, repo_owner, repo_name, kind, number, created_at"
LISTING_FIELDS = (
    "id, author_id, author_name, repo_id, repo_owner, repo_name, issue_number, description, created_at"
)
REFERENCE_KINDS = ("repo", "issue", "pr")
DESCRIPTION_LIMIT = 4000


def init(db):
    db.execute("""CREATE TABLE IF NOT EXISTS post_references (
        post_id INTEGER PRIMARY KEY,
        repo_id INTEGER NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('repo', 'issue', 'pr')),
        number INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK ((kind = 'repo' AND number IS NULL)
            OR (kind IN ('issue', 'pr') AND number IS NOT NULL AND number > 0))
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS work_listings (
        id INTEGER PRIMARY KEY,
        author_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        repo_id INTEGER NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        issue_number INTEGER NOT NULL CHECK (issue_number > 0),
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS post_references_repo ON post_references(repo_id, kind, number)")
    db.execute("CREATE INDEX IF NOT EXISTS work_listings_repo ON work_listings(repo_id, id)")
    db.execute("CREATE INDEX IF NOT EXISTS work_listings_author ON work_listings(author_id, id)")


def _positive(value, name):
    if type(value) is not int or value <= 0:
        raise ValueError(name + " must be a positive integer")
    return value


def _label(value, name):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 255:
        raise ValueError(name + " must be a non-empty string of at most 255 characters")
    return value.strip()


def _describer(value, name):
    if not isinstance(value, str):
        raise ValueError(name + " must be a string")
    value = value.strip()
    if not 1 <= len(value) <= DESCRIPTION_LIMIT:
        raise ValueError(name + " must contain 1–" + str(DESCRIPTION_LIMIT) + " characters")
    return value


def _identity(user, name):
    if not isinstance(user, dict):
        raise ValueError(name + " must be an object")
    return _positive(user.get("id"), name + ".id"), _label(user.get("login"), name + ".login")


def _repository(repo):
    if not isinstance(repo, dict):
        raise ValueError("repo must be an object")
    return (_positive(repo.get("id"), "repo.id"),
            _label(repo.get("owner"), "repo.owner"),
            _label(repo.get("name"), "repo.name"))


def _rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _reference(db, post_id):
    cursor = db.execute("SELECT " + REFERENCE_FIELDS + " FROM post_references WHERE post_id = ?", (post_id,))
    rows = _rows(cursor)
    return rows[0] if rows else None


def _listing(db, listing_id):
    cursor = db.execute("SELECT " + LISTING_FIELDS + " FROM work_listings WHERE id = ?", (listing_id,))
    rows = _rows(cursor)
    return rows[0] if rows else None


def add_reference(db, post_id, repo, kind, number):
    """Attach the reference chosen when a post is created.

    repo is the Gitea repository dict (id, owner, name) as returned by gitea.repository.
    kind is 'repo' for a repository-only reference, or 'issue'/'pr'; number is required
    for the latter. Repository permissions and the existence of the referenced Gitea
    object are validated by the caller for the current viewer.
    """
    post_id = _positive(post_id, "post_id")
    repo_id, owner, name = _repository(repo)
    if kind not in REFERENCE_KINDS:
        raise ValueError("kind must be one of " + ", ".join(REFERENCE_KINDS))
    if kind == "repo":
        if number is not None:
            raise ValueError("number must be omitted for a repository reference")
    else:
        number = _positive(number, "number")
    try:
        db.execute("""INSERT INTO post_references (post_id, repo_id, repo_owner, repo_name, kind, number)
                      VALUES (?, ?, ?, ?, ?, ?)""", (post_id, repo_id, owner, name, kind, number))
    except sqlite3.IntegrityError as error:
        raise ValueError("post already has a reference") from error
    return _reference(db, post_id)


def get_reference(db, post_id):
    return _reference(db, post_id)


def references(db, post_ids):
    """Return {post_id: reference} for the supplied posts, without visibility filtering."""
    ids = [_positive(post_id, "post_id") for post_id in post_ids]
    if not ids:
        return {}
    placeholders = ", ".join("?" for _ in ids)
    cursor = db.execute(
        "SELECT " + REFERENCE_FIELDS + " FROM post_references WHERE post_id IN (" + placeholders + ")",
        ids)
    return {row["post_id"]: row for row in _rows(cursor)}


def create_listing(db, user, repo, issue_number, description):
    """Publish a public work listing; the caller checks repository visibility for readers."""
    author_id, author_name = _identity(user, "user")
    repo_id, owner, name = _repository(repo)
    issue_number = _positive(issue_number, "issue_number")
    description = _describer(description, "description")
    cursor = db.execute("""INSERT INTO work_listings
        (author_id, author_name, repo_id, repo_owner, repo_name, issue_number, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (author_id, author_name, repo_id, owner, name, issue_number, description))
    return _listing(db, cursor.lastrowid)


def get_listing(db, listing_id):
    return _listing(db, listing_id)


def list_listings(db):
    cursor = db.execute("SELECT " + LISTING_FIELDS + " FROM work_listings ORDER BY id DESC")
    return _rows(cursor)
