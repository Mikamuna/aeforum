# Copyright 2026 The Gitea Authors. All rights reserved.
# SPDX-License-Identifier: MIT

"""Independent A2A 1.0.0 HTTP+JSON client for the demo Gitea issue Agent.

This client shares no Python modules with the Agent implementation. It uses
only the standard library, discovers the Agent Card at the standardized
well-known path, selects an HTTP+JSON / A2A 1.0 interface, sends one text
message, polls GetTask when necessary, and validates the returned artifact
against the requested Gitea issue.

Authentication uses the caller's own Gitea personal access token as a Bearer
credential, matching the Agent Card. The token is read from ``GITEA_TOKEN``
so it never appears on the process command line.
"""

import argparse
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

PROTOCOL_VERSION = "1.0"
SKILL_ID = "summarize-gitea-issue"
MAX_RESPONSE = 1024 * 1024
TASK_STATES = frozenset({
    "TASK_STATE_UNSPECIFIED", "TASK_STATE_SUBMITTED", "TASK_STATE_WORKING",
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED",
    "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_REJECTED", "TASK_STATE_AUTH_REQUIRED",
})
TERMINAL_STATES = frozenset({
    "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED",
    "TASK_STATE_REJECTED",
})
INTERRUPTED_STATES = frozenset({
    "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED",
})
REFERENCE_PATTERN = re.compile(
    r"^([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]{0,9})$")
VERSION_PATTERN = re.compile(r"^([0-9]+)\.([0-9]+)(?:\.[0-9]+)?$")


class ClientError(Exception):
    pass


def positive_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("must be a positive number") from None
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive number")
    return number


def non_negative_int(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("must be a non-negative integer") from None
    if number < 0:
        raise argparse.ArgumentTypeError("must be a non-negative integer")
    return number


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Independent A2A 1.0.0 HTTP+JSON client for the demo Gitea issue Agent.",
        epilog=(
            "GITEA_TOKEN must contain the caller's Gitea personal access token. "
            "A2A_URL defaults to http://localhost:3002; A2A_TIMEOUT defaults to 30."
        ),
    )
    parser.add_argument("issue", help="Issue reference exactly owner/repo#number")
    parser.add_argument(
        "--url", default=os.environ.get("A2A_URL", "http://localhost:3002"),
        help="A2A origin used for Agent Card discovery (default: A2A_URL)")
    parser.add_argument(
        "--timeout", type=positive_float,
        default=os.environ.get("A2A_TIMEOUT", "30"),
        help="Network and polling timeout in seconds (default: 30)")
    parser.add_argument(
        "--history-length", type=non_negative_int, default=10,
        help="historyLength requested for the task (default: 10)")
    parser.add_argument(
        "--json", action="store_true",
        help="Write validated Task JSON to stdout and the summary to stderr")
    return parser.parse_args(argv)


def normalize_modes(values):
    result = []
    for value in values:
        if isinstance(value, str):
            result.append(value.split(";", 1)[0].strip().lower())
    return result


def same_protocol(value, expected):
    match = VERSION_PATTERN.fullmatch(value.strip())
    wanted = VERSION_PATTERN.fullmatch(expected)
    return bool(match and wanted and match.group(1) == wanted.group(1)
                and match.group(2) == wanted.group(2))


def validate_card(card):
    if not isinstance(card, dict):
        raise ClientError("Agent Card is not a JSON object.")
    for field in ("name", "description", "version"):
        value = card.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ClientError("Agent Card field " + field + " must be a non-empty string.")
    interfaces = card.get("supportedInterfaces")
    if not isinstance(interfaces, list) or not interfaces:
        raise ClientError("Agent Card has no supportedInterfaces.")
    selected = None
    advertised = []
    for index, interface in enumerate(interfaces):
        prefix = "supportedInterfaces[" + str(index) + "]"
        if not isinstance(interface, dict):
            raise ClientError(prefix + " must be an object.")
        url = interface.get("url")
        binding = interface.get("protocolBinding")
        version = interface.get("protocolVersion")
        if not isinstance(url, str) or not url:
            raise ClientError(prefix + ".url is required.")
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ClientError(prefix + ".url must be an absolute http(s) URL.")
        if parsed.query or parsed.fragment:
            raise ClientError(prefix + ".url must not contain a query or fragment.")
        if not isinstance(binding, str) or not binding:
            raise ClientError(prefix + ".protocolBinding is required.")
        if not isinstance(version, str) or not version:
            raise ClientError(prefix + ".protocolVersion is required.")
        advertised.append(binding + " " + version)
        if (selected is None and binding == "HTTP+JSON"
                and same_protocol(version, PROTOCOL_VERSION)):
            selected = {
                "url": url.rstrip("/"),
                "binding": binding,
                "protocolVersion": version,
            }
    if selected is None:
        raise ClientError("Agent does not advertise HTTP+JSON A2A 1.0; advertised: "
                          + ", ".join(advertised) + ".")
    capabilities = card.get("capabilities")
    if not isinstance(capabilities, dict):
        raise ClientError("Agent Card capabilities must be an object.")
    for field in ("defaultInputModes", "defaultOutputModes"):
        values = card.get(field)
        if (not isinstance(values, list) or not values
                or not all(isinstance(item, str) for item in values)):
            raise ClientError("Agent Card " + field + " must be a non-empty string array.")
    skills = card.get("skills")
    if not isinstance(skills, list) or not skills:
        raise ClientError("Agent Card has no skills.")
    skill = None
    for item in skills:
        if not isinstance(item, dict):
            raise ClientError("Every Agent Card skill must be an object.")
        if item.get("id") == SKILL_ID:
            skill = item
            break
    if skill is None:
        raise ClientError("Agent does not advertise the required skill " + SKILL_ID + ".")
    for field in ("id", "name", "description"):
        value = skill.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ClientError("Skill field " + field + " must be a non-empty string.")
    input_modes = skill.get("inputModes", card["defaultInputModes"])
    output_modes = skill.get("outputModes", card["defaultOutputModes"])
    if not isinstance(input_modes, list) or "text/plain" not in normalize_modes(input_modes):
        raise ClientError("Skill does not advertise text/plain input.")
    if (not isinstance(output_modes, list)
            or not any(mode in ("application/json", "text/plain")
                       for mode in normalize_modes(output_modes))):
        raise ClientError("Skill does not advertise a supported output mode.")
    warnings = []
    schemes = card.get("securitySchemes")
    if not isinstance(schemes, dict) or not schemes:
        warnings.append("Agent Card does not declare securitySchemes; sending a Bearer token anyway.")
    elif not any(isinstance(value, dict) and (
            "httpAuthSecurityScheme" in value or "apiKeySecurityScheme" in value)
            for value in schemes.values()):
        warnings.append("Agent Card securitySchemes do not describe an HTTP token scheme.")
    requirements = card.get("securityRequirements")
    if requirements is not None:
        if not isinstance(requirements, list):
            raise ClientError("securityRequirements must be an array.")
        if not all(isinstance(item, dict) for item in requirements):
            raise ClientError("Every securityRequirements entry must be an object.")
    if capabilities.get("streaming") is True:
        warnings.append("Agent advertises streaming; this client uses non-streaming message:send.")
    if capabilities.get("pushNotifications") is True:
        warnings.append("Agent advertises push notifications; this client polls instead.")
    if capabilities.get("extendedAgentCard") is True:
        warnings.append("Agent advertises an extended Agent Card; this client uses the public card.")
    return {
        "card": card,
        "interface": selected,
        "skill": skill,
        "warnings": warnings,
    }


def security_summary(card):
    schemes = card.get("securitySchemes")
    if not isinstance(schemes, dict) or not schemes:
        return "not declared"
    labels = []
    for name, scheme in schemes.items():
        if not isinstance(scheme, dict):
            continue
        http = scheme.get("httpAuthSecurityScheme")
        api_key = scheme.get("apiKeySecurityScheme")
        if isinstance(http, dict):
            labels.append(str(name) + " (HTTP " + str(http.get("scheme")) + ")")
        elif isinstance(api_key, dict):
            labels.append(str(name) + " (API key header)")
        else:
            labels.append(str(name))
    return ", ".join(labels) if labels else "not declared"

def format_http_error(status, raw, url):
    message = "HTTP " + str(status) + " from " + url
    payload = None
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        pass
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        error = payload["error"]
        reason = None
        details = error.get("details")
        if isinstance(details, list):
            for detail in details:
                if (isinstance(detail, dict)
                        and detail.get("@type") == "type.googleapis.com/google.rpc.ErrorInfo"):
                    reason = detail.get("reason")
                    break
        if isinstance(reason, str) and reason:
            message += " (" + reason + ")"
        text = error.get("message")
        if isinstance(text, str) and text:
            message += ": " + text
    if status == 401:
        message += " Check GITEA_TOKEN: it must be a valid caller token."
    elif status == 403:
        message += " The caller must currently have read access to the repository."
    elif status == 503:
        message += " The Agent or Gitea is unavailable; retry later."
    return message


def response_json(response, url):
    content_type = response.headers.get("Content-Type", "")
    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type not in ("application/json", "application/a2a+json"):
        raise ClientError("Response from " + url + " is not JSON (Content-Type: "
                          + (content_type or "missing") + ").")
    raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ClientError("Response from " + url + " exceeds " + str(MAX_RESPONSE) + " bytes.")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ClientError("Response from " + url + " is not valid JSON.") from None


def request_json(url, token, version, timeout, method="GET", payload=None):
    headers = {
        "Accept": "application/json",
        "User-Agent": "a2a-demo-client/" + PROTOCOL_VERSION,
    }
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    if version is not None:
        headers["A2A-Version"] = version
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, headers=headers, data=data, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response_json(response, url)
    except HTTPError as error:
        try:
            raw = error.read(MAX_RESPONSE)
        except OSError:
            raw = b""
        raise ClientError(format_http_error(error.code, raw, url)) from None
    except URLError as error:
        raise ClientError("Cannot reach " + url + ": "
                          + str(getattr(error, "reason", error))) from None
    except OSError as error:
        raise ClientError("Network error talking to " + url + ": "
                          + str(error)) from None


def origin_for(value):
    parsed = urlsplit(value.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ClientError("A2A_URL must be an absolute http(s) URL.")
    if parsed.query or parsed.fragment:
        raise ClientError("A2A_URL must not contain a query or fragment.")
    if parsed.path not in ("", "/"):
        print("note: ignoring the path in A2A_URL for well-known discovery; "
              "the Agent Card interface URL is used for operations.", file=sys.stderr)
    return parsed.scheme + "://" + parsed.netloc


def discover(origin, timeout):
    card_url = origin + "/.well-known/agent-card.json"
    card = request_json(card_url, None, None, timeout)
    return validate_card(card)


def parse_timestamp(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ClientError(field + " must be an ISO 8601 timestamp.")
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ClientError(field + " must be an ISO 8601 timestamp.") from None
    if parsed.tzinfo is None:
        raise ClientError(field + " must include a UTC offset or Z.")
    return parsed


def validate_part(part, field):
    if not isinstance(part, dict):
        raise ClientError(field + " must be an object.")
    content = [key for key in ("text", "raw", "url", "data") if key in part]
    if len(content) != 1:
        raise ClientError(field + " must contain exactly one of text, raw, url or data.")
    key = content[0]
    if key == "text" and not isinstance(part["text"], str):
        raise ClientError(field + ".text must be a string.")
    if key == "raw" and not isinstance(part["raw"], str):
        raise ClientError(field + ".raw must be a base64 string.")
    if key == "url" and not isinstance(part["url"], str):
        raise ClientError(field + ".url must be a string.")
    for name in ("filename", "mediaType"):
        value = part.get(name)
        if value is not None and not isinstance(value, str):
            raise ClientError(field + "." + name + " must be a string.")
    metadata = part.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise ClientError(field + ".metadata must be an object.")


def validate_message(message, expected_role, field):
    if not isinstance(message, dict):
        raise ClientError(field + " must be an object.")
    message_id = message.get("messageId")
    if not isinstance(message_id, str) or not message_id.strip():
        raise ClientError(field + ".messageId must be a non-empty string.")
    role = message.get("role")
    if role not in ("ROLE_USER", "ROLE_AGENT"):
        raise ClientError(field + ".role must be ROLE_USER or ROLE_AGENT.")
    if expected_role is not None and role != expected_role:
        raise ClientError(field + ".role must be " + expected_role + ".")
    for key in ("contextId", "taskId"):
        value = message.get(key)
        if value is not None and not isinstance(value, str):
            raise ClientError(field + "." + key + " must be a string.")
    parts = message.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ClientError(field + ".parts must be a non-empty array.")
    for index, part in enumerate(parts):
        validate_part(part, field + ".parts[" + str(index) + "]")
    return message


def validate_artifact(artifact, field):
    if not isinstance(artifact, dict):
        raise ClientError(field + " must be an object.")
    artifact_id = artifact.get("artifactId")
    if not isinstance(artifact_id, str) or not artifact_id.strip():
        raise ClientError(field + ".artifactId must be a non-empty string.")
    for name in ("name", "description"):
        value = artifact.get(name)
        if value is not None and not isinstance(value, str):
            raise ClientError(field + "." + name + " must be a string.")
    parts = artifact.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ClientError(field + ".parts must be a non-empty array.")
    for index, part in enumerate(parts):
        validate_part(part, field + ".parts[" + str(index) + "]")
    metadata = artifact.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise ClientError(field + ".metadata must be an object.")
    extensions = artifact.get("extensions")
    if extensions is not None and (not isinstance(extensions, list)
                                   or not all(isinstance(item, str) for item in extensions)):
        raise ClientError(field + ".extensions must be a string array.")


def validate_task(task, field="task"):
    if not isinstance(task, dict):
        raise ClientError(field + " must be an object.")
    task_id = task.get("id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ClientError(field + ".id must be a non-empty string.")
    context_id = task.get("contextId")
    if context_id is not None and not isinstance(context_id, str):
        raise ClientError(field + ".contextId must be a string.")
    status = task.get("status")
    if not isinstance(status, dict):
        raise ClientError(field + ".status must be an object.")
    state = status.get("state")
    if state not in TASK_STATES:
        raise ClientError(field + ".status.state must be a TASK_STATE_* value.")
    timestamp = status.get("timestamp")
    if timestamp is not None:
        parse_timestamp(timestamp, field + ".status.timestamp")
    status_message = status.get("message")
    if status_message is not None:
        validate_message(status_message, "ROLE_AGENT", field + ".status.message")
    artifacts = task.get("artifacts")
    if artifacts is not None:
        if not isinstance(artifacts, list):
            raise ClientError(field + ".artifacts must be an array.")
        seen = set()
        for index, artifact in enumerate(artifacts):
            prefix = field + ".artifacts[" + str(index) + "]"
            validate_artifact(artifact, prefix)
            if artifact["artifactId"] in seen:
                raise ClientError(field + " has duplicate artifactId "
                                  + artifact["artifactId"] + ".")
            seen.add(artifact["artifactId"])
    history = task.get("history")
    if history is not None:
        if not isinstance(history, list):
            raise ClientError(field + ".history must be an array.")
        for index, message in enumerate(history):
            validate_message(message, None, field + ".history[" + str(index) + "]")
    metadata = task.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        raise ClientError(field + ".metadata must be an object.")
    return task


def extract_text(message):
    chunks = []
    for part in message.get("parts", []):
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            chunks.append(part["text"])
    return " ".join(chunks) if chunks else "(no text part)"


def validate_send_response(data):
    if not isinstance(data, dict):
        raise ClientError("message:send response must be a JSON object.")
    has_task = "task" in data
    has_message = "message" in data
    if has_task == has_message:
        raise ClientError("message:send response must contain exactly one of task or message.")
    if has_task:
        return validate_task(data["task"]), None
    message = validate_message(data["message"], "ROLE_AGENT", "response.message")
    return None, message

def wait_for_terminal(interface_url, task, token, timeout, history_length):
    deadline = time.monotonic() + timeout
    original_id = task["id"]
    current = task
    while True:
        state = current["status"]["state"]
        if state in TERMINAL_STATES or state in INTERRUPTED_STATES:
            return current
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ClientError("Timed out waiting for task " + original_id + " to finish.")
        time.sleep(min(1.0, remaining))
        task_url = (interface_url + "/tasks/" + quote(original_id, safe="")
                    + "?historyLength=" + str(history_length))
        data = request_json(task_url, token, PROTOCOL_VERSION, max(remaining, 1.0))
        current = validate_task(data)
        if current["id"] != original_id:
            raise ClientError("Task ID changed while polling: "
                              + original_id + " -> " + current["id"] + ".")


def validate_result(task, repository, number):
    if task["status"]["state"] != "TASK_STATE_COMPLETED":
        raise ClientError("Task did not complete successfully: "
                          + task["status"]["state"] + ".")
    artifacts = task.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ClientError("Completed task has no artifacts.")
    matched = None
    for artifact in artifacts:
        for part in artifact["parts"]:
            data = part.get("data")
            if not isinstance(data, dict):
                continue
            repo_value = data.get("repository")
            number_value = data.get("number")
            if (isinstance(repo_value, str)
                    and repo_value.casefold() == repository.casefold()
                    and type(number_value) is int and number_value == number):
                title = data.get("title")
                state = data.get("state")
                if not isinstance(title, str) or not isinstance(state, str) or not state:
                    raise ClientError("Matching artifact data lacks a title or state.")
                matched = data
                break
        if matched is not None:
            break
    if matched is None:
        raise ClientError("No artifact data matches " + repository + "#" + str(number) + ".")
    title = matched["title"]
    state = matched["state"]
    url = matched.get("url")
    if url is not None:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ClientError("Artifact issue URL is not an absolute http(s) URL.")
    retrieved_at = matched.get("retrievedAt")
    if retrieved_at is not None:
        parse_timestamp(retrieved_at, "artifact.data.retrievedAt")
    summary = None
    for artifact in artifacts:
        for part in artifact["parts"]:
            text = part.get("text")
            if isinstance(text, str) and title in text and state in text:
                summary = text
                break
        if summary is not None:
            break
    if summary is None:
        raise ClientError("No artifact text states the issue title and state.")
    metadata = task.get("metadata")
    if isinstance(metadata, dict):
        meta_repo = metadata.get("repository")
        meta_number = metadata.get("issueNumber")
        if isinstance(meta_repo, str) and meta_repo.casefold() != repository.casefold():
            raise ClientError("Task metadata repository does not match the request.")
        if meta_number is not None and (
                type(meta_number) is not int or meta_number != number):
            raise ClientError("Task metadata issueNumber does not match the request.")
    return matched, summary


def print_human(info, task, data, summary, stream):
    card = info["card"]
    interface = info["interface"]
    capabilities = card.get("capabilities") or {}
    lines = [
        "agent: " + card["name"] + " " + card["version"],
        "description: " + card["description"],
        "interface: " + interface["binding"] + " " + interface["protocolVersion"]
        + " " + interface["url"],
        "skill: " + info["skill"]["id"] + " - " + info["skill"]["name"],
        "auth: " + security_summary(card),
        "capabilities: streaming=" + str(bool(capabilities.get("streaming")))
        + " pushNotifications=" + str(bool(capabilities.get("pushNotifications")))
        + " extendedAgentCard=" + str(bool(capabilities.get("extendedAgentCard"))),
        "task: " + task["id"] + " " + task["status"]["state"],
        "repository: " + data["repository"],
        "issue: #" + str(data["number"]),
        "title: " + data["title"],
        "state: " + data["state"],
        "summary: " + summary,
        "validation: completed task artifact matches the requested Gitea issue",
    ]
    print("\n".join(lines), file=stream)


def print_task_failure(task, stream):
    status = task["status"]
    message = status.get("message")
    text = extract_text(message) if isinstance(message, dict) else "(no status message)"
    print("task: " + task["id"] + " " + status["state"], file=stream)
    print("status: " + text, file=stream)
    print("validation: task did not complete successfully", file=stream)


def main(argv=None):
    args = parse_args(argv)
    token = os.environ.get("GITEA_TOKEN", "").strip()
    if not token:
        print("error: GITEA_TOKEN must contain the caller's Gitea personal access token.",
              file=sys.stderr)
        return 1
    reference = args.issue.strip()
    match = REFERENCE_PATTERN.fullmatch(reference)
    if not match:
        print("error: issue must be exactly owner/repo#number.", file=sys.stderr)
        return 1
    repository = match.group(1) + "/" + match.group(2)
    number = int(match.group(3))
    try:
        origin = origin_for(args.url)
        info = discover(origin, args.timeout)
        for warning in info["warnings"]:
            print("warning: " + warning, file=sys.stderr)
        interface_url = info["interface"]["url"]
        payload = {
            "message": {
                "messageId": str(uuid.uuid4()),
                "role": "ROLE_USER",
                "parts": [{"text": reference}],
            },
            "configuration": {
                "acceptedOutputModes": ["application/json", "text/plain"],
                "historyLength": args.history_length,
                "returnImmediately": False,
            },
        }
        response = request_json(
            interface_url + "/message:send", token, PROTOCOL_VERSION, args.timeout,
            method="POST", payload=payload)
        task, message = validate_send_response(response)
        if message is not None:
            print("error: Agent returned a direct Message instead of a Task: "
                  + extract_text(message), file=sys.stderr)
            return 1
        task = wait_for_terminal(interface_url, task, token, args.timeout,
                                 args.history_length)
        output = sys.stderr if args.json else sys.stdout
        if task["status"]["state"] != "TASK_STATE_COMPLETED":
            print_task_failure(task, output)
            if args.json:
                print(json.dumps(task, ensure_ascii=False, indent=2, sort_keys=True),
                      file=sys.stdout)
            if task["status"]["state"] in INTERRUPTED_STATES:
                return 2
            return 1
        data, summary = validate_result(task, repository, number)
        print_human(info, task, data, summary, output)
        if args.json:
            print(json.dumps(task, ensure_ascii=False, indent=2, sort_keys=True),
                  file=sys.stdout)
        return 0
    except ClientError as error:
        print("error: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
