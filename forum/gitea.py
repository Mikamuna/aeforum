# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

import json
import os
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

GITEA_URL = os.environ.get("GITEA_URL", "http://gitea:3000").rstrip("/")


class AccessDenied(Exception):
    pass


def request(token, path, method="GET", data=None):
    headers = {"Authorization": "token " + token}
    if data is not None:
        headers["Content-Type"] = "application/json"
    query = Request(GITEA_URL + "/api/v1" + path, headers=headers, method=method,
                    data=json.dumps(data).encode() if data is not None else None)
    try:
        with urlopen(query, timeout=5) as response:
            return json.load(response) if response.status != 204 else None
    except HTTPError as error:
        if error.code in (401, 403, 404):
            raise AccessDenied() from error
        raise


def identity(token):
    if not token:
        return None
    try:
        user = request(token, "/user")
        return {"id": user["id"], "login": user["login"]}
    except AccessDenied:
        return None


def account(token, name):
    if not isinstance(name, str) or not name or "/" in name:
        raise ValueError("Invalid account name")
    user = request(token, "/users/" + quote(name, safe=""))
    return {"id": user["id"], "login": user["login"]}


def repository(token, full_name, write=False):
    if not isinstance(full_name, str) or full_name.count("/") != 1:
        raise ValueError("Repository must be owner/name")
    owner, name = full_name.split("/")
    if not owner or not name or owner in (".", "..") or name in (".", ".."):
        raise ValueError("Repository must be owner/name")
    repo = request(token, "/repos/" + quote(owner, safe="") + "/" + quote(name, safe=""))
    permissions = repo.get("permissions") or {}
    if not permissions.get("push" if write else "pull"):
        raise AccessDenied()
    return {"id": repo["id"], "owner": repo["owner"]["login"], "name": repo["name"],
            "permissions": permissions}


def issue(token, repo, number):
    item = request(token, "/repos/" + quote(repo["owner"], safe="") + "/" +
                   quote(repo["name"], safe="") + "/issues/" + str(number))
    if item.get("pull_request"):
        raise ValueError("The target must be an issue, not a pull request")
    return item


def pull_request(token, repo, number, assignee_id):
    item = request(token, "/repos/" + quote(repo["owner"], safe="") + "/" +
                   quote(repo["name"], safe="") + "/pulls/" + str(number))
    if item["base"]["repo"]["id"] != repo["id"] or item["user"]["id"] != assignee_id:
        raise ValueError("PR must target this repository and be submitted by the assignee")
    return item


def reference(token, repo, kind, number):
    if kind == "repo":
        return repo
    if kind == "issue":
        return issue(token, repo, number)
    if kind == "pr":
        item = request(token, "/repos/" + quote(repo["owner"], safe="") + "/" +
                       quote(repo["name"], safe="") + "/pulls/" + str(number))
        if item["base"]["repo"]["id"] != repo["id"]:
            raise AccessDenied()
        return item
    raise ValueError("Reference kind must be repo, issue, or pr")


def my_repositories(token):
    repositories = []
    page = 1
    while True:
        batch = request(token, "/user/repos?limit=50&page=" + str(page))
        repositories.extend({"id": repo["id"], "full_name": repo["full_name"],
                             "permissions": repo.get("permissions")} for repo in batch)
        if len(batch) < 50:
            return repositories
        page += 1
