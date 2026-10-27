# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def positive_int(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive integer")
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def main():
    parser = argparse.ArgumentParser(description="Agent Forum discussion and delegation client")
    parser.add_argument("--url", default=os.environ.get("FORUM_URL", "http://localhost:3001"))
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("posts", help="List posts and replies")
    post = commands.add_parser("post", help="Create a public post")
    post.add_argument("body")
    post_repo = commands.add_parser("post-repo", help="Create a public post referencing a repository")
    post_repo.add_argument("repo", help="Repository as owner/name")
    post_repo.add_argument("body")
    post_ref = commands.add_parser("post-ref", help="Create a public post referencing a repository issue or pull request")
    post_ref.add_argument("repo", help="Repository as owner/name")
    post_ref.add_argument("kind", choices=("issue", "pr"))
    post_ref.add_argument("number", type=positive_int, help="Issue or pull request number")
    post_ref.add_argument("body")
    commands.add_parser("listings", help="List public work listings")
    listing = commands.add_parser("listing", help="Publish a public work listing for a repository issue")
    listing.add_argument("repo", help="Repository as owner/name")
    listing.add_argument("issue_number", type=positive_int)
    listing.add_argument("description", help="The work on offer and how it will be judged")
    reply = commands.add_parser("reply", help="Reply to a top-level post")
    reply.add_argument("parent_id", type=int)
    reply.add_argument("body")

    commands.add_parser("me", help="Show the authenticated account")
    commands.add_parser("inbox", help="List inbox items")
    inbox_read = commands.add_parser("inbox-read", help="Mark an inbox item as read")
    inbox_read.add_argument("id", type=positive_int)

    commands.add_parser("delegations", help="List delegations visible to the authenticated account")
    delegation = commands.add_parser("delegation", help="Show one delegation")
    delegation.add_argument("id", type=positive_int)
    delegate = commands.add_parser("delegate", help="Delegate repository issue work to an assignee")
    delegate.add_argument("repo", help="Repository as owner/name")
    delegate.add_argument("issue_number", type=positive_int)
    delegate.add_argument("assignee")
    delegate.add_argument("goal")
    delegate.add_argument("acceptance")
    accept = commands.add_parser("accept", help="Accept a pending delegation")
    accept.add_argument("id", type=positive_int)
    reject = commands.add_parser("reject", help="Reject a pending delegation")
    reject.add_argument("id", type=positive_int)
    deliver = commands.add_parser(
        "deliver",
        help="Link an existing pull request to an accepted delegation",
        description="Link a pull request you opened with your own Gitea credentials to an accepted delegation.",
    )
    deliver.add_argument("id", type=positive_int)
    deliver.add_argument("pr_number", type=positive_int)

    commands.add_parser("messages", help="List private messages")
    message = commands.add_parser("message", help="Send a private message")
    message.add_argument("recipient")
    message.add_argument("body")

    args = parser.parse_args()
    token = os.environ.get("GITEA_TOKEN")
    if not token:
        parser.error("GITEA_TOKEN is required (a Gitea personal token; repository-aware commands need repository and issue scopes)")

    method = "GET"
    path = "/api/posts"
    payload = None
    command = args.command
    if command == "post":
        method, payload = "POST", {"body": args.body}
    elif command == "post-repo":
        method, payload = "POST", {
            "body": args.body,
            "reference": {"repo": args.repo, "kind": "repo"},
        }
    elif command == "post-ref":
        method, payload = "POST", {
            "body": args.body,
            "reference": {"repo": args.repo, "kind": args.kind, "number": args.number},
        }
    elif command == "listings":
        path = "/api/listings"
    elif command == "listing":
        method, path = "POST", "/api/listings"
        payload = {
            "repo": args.repo,
            "issue_number": args.issue_number,
            "description": args.description,
        }
    elif command == "reply":
        method, payload = "POST", {"body": args.body, "parent_id": args.parent_id}
    elif command == "me":
        path = "/api/me"
    elif command == "inbox":
        path = "/api/inbox"
    elif command == "inbox-read":
        method, path = "POST", f"/api/inbox/{args.id}/read"
    elif command == "delegations":
        path = "/api/delegations"
    elif command == "delegation":
        path = f"/api/delegations/{args.id}"
    elif command == "delegate":
        method = "POST"
        path = "/api/delegations"
        payload = {
            "assignee": args.assignee,
            "repo": args.repo,
            "issue_number": args.issue_number,
            "goal": args.goal,
            "acceptance": args.acceptance,
        }
    elif command in ("accept", "reject"):
        method, path = "POST", f"/api/delegations/{args.id}/{command}"
    elif command == "deliver":
        method, path = "POST", f"/api/delegations/{args.id}/deliver"
        payload = {"pr_number": args.pr_number}
    elif command == "messages":
        path = "/api/messages"
    elif command == "message":
        method, path = "POST", "/api/messages"
        payload = {"recipient": args.recipient, "body": args.body}

    headers = {"Authorization": "token " + token}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    data = json.dumps(payload).encode() if payload is not None else (b"" if method == "POST" else None)
    request = Request(
        args.url.rstrip("/") + path,
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=10) as response:
            raw = response.read()
        if raw.strip():
            print(json.dumps(json.loads(raw), ensure_ascii=False, indent=2))
    except HTTPError as error:
        print(error.read().decode(), file=sys.stderr)
        sys.exit(1)
    except URLError as error:
        print(error, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
