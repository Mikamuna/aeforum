"""HTTP-level regression for browser CSRF and independent Agent bearer access."""

import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class SessionHTTPTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = patch.object(server, "DB_PATH", str(Path(self.tmp.name) / "forum.sqlite3"))
        self.db_path.start()
        server.SESSIONS.clear()
        server.initialize()
        self.identity = patch.object(server.gitea, "identity", side_effect=lambda token: {
            "human": {"id": 1, "login": "human"},
            "agent": {"id": 2, "login": "agent"},
        }.get(token))
        self.identity.start()
        self.account = patch.object(server.gitea, "account", side_effect=lambda token, name: {
            "id": 2, "login": "agent"
        } if name == "agent" else {"id": 1, "login": "human"})
        self.account.start()
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.http.server_port)

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.account.stop()
        self.identity.stop()
        self.db_path.stop()
        server.SESSIONS.clear()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        request = Request(self.base + path, method=method, data=json.dumps(body).encode() if body is not None else (b"" if method == "POST" else None), headers=headers or {})
        try:
            with urlopen(request, timeout=5) as response:
                return response.status, json.load(response), response.headers
        except HTTPError as error:
            return error.code, json.load(error), error.headers

    def test_browser_mutations_require_csrf_without_changing_bearer_api(self):
        status, login, headers = self.request("POST", "/api/session", {"token": "human"}, {
            "Content-Type": "application/json", "Origin": self.base,
        })
        self.assertEqual(status, 200)
        cookie = next(value for value in headers.get_all("Set-Cookie") if "Max-Age" not in value)
        self.assertIn("HttpOnly; SameSite=Strict; Path=/forum", cookie)
        browser = {"Cookie": cookie.split(";", 1)[0], "Content-Type": "application/json"}
        message = {"recipient": "agent", "body": "Review the Gitea issue"}
        self.assertEqual(self.request("POST", "/api/messages", message, browser)[0], 403)
        self.assertEqual(self.request("POST", "/api/messages", message, {**browser, "X-CSRF-Token": "wrong"})[0], 403)
        self.assertEqual(self.request("GET", "/api/messages", headers={"Authorization": "token human"})[1], [])

        status, sent, _ = self.request("POST", "/api/messages", message, {**browser, "X-CSRF-Token": login["csrf"]})
        self.assertEqual(status, 201)
        self.assertEqual(sent["recipient_name"], "agent")
        status, sent_by_agent, _ = self.request("POST", "/api/messages", {"recipient": "human", "body": "Acknowledged"}, {
            "Authorization": "token agent", "Content-Type": "application/json",
        })
        self.assertEqual(status, 201)
        status, inbox, _ = self.request("GET", "/api/messages", headers={"Authorization": "token human"})
        self.assertEqual([item["body"] for item in inbox], ["Review the Gitea issue", "Acknowledged"])
        self.assertEqual(self.request("POST", "/api/logout", headers={**browser, "X-CSRF-Token": login["csrf"]})[0], 200)
        self.assertEqual(self.request("GET", "/api/session", headers=browser)[0], 401)
        self.assertEqual(self.request("POST", "/api/session", {"token": "human"}, {
            "Content-Type": "application/json", "Origin": "http://attacker.invalid",
        })[0], 403)


if __name__ == "__main__":
    unittest.main()
