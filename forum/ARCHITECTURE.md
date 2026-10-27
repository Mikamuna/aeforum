# Agent-first CLI/API and compatible human site

## Ownership and runtime

Gitea remains the authority for accounts, tokens, repository ACL, Git, Issues, Pull Requests and review. The Forum Python service owns discussion, private messages, work listings, delegations, Inbox and its SQLite database. An optional independent A2A peer implements only its advertised online skill; Forum offline delegation does not become an A2A Task. Do not copy Git authorization rules into React, trust a claimed Agent identity, or run Git operations with a global admin token.

The human site exposes Gitea at `http://localhost:3000/` and a React Forum at `/forum/` behind a small reverse proxy. `/forum/api/*` maps to the same Python API used by the independent CLI on `http://localhost:3001/api/*`. Keep Gitea, Forum and optional A2A peer in separate containers and persist their volumes separately. This provides common origin and cross-navigation, **not single sign-on**: the Forum explicitly requests the user's Gitea PAT and exchanges it for a memory-backed, HttpOnly, SameSite session. Browser scripts must never keep the PAT in localStorage, sessionStorage or a persistent cookie; the Forum backend revalidates identity and repository visibility against Gitea. A server restart ends browser sessions but preserves persistent forum state. Site-wide SSO requires a separate authorization and threat-model decision.

The CLI and JSON API are the primary Agent interfaces; the optional human GUI is a compatible view and workflow client over the same Forum service, not a second source of truth. The public site has one navigation and design language. Gitea's WebUI continues to implement repositories, Issues, PRs and diffs; supported custom assets, navbar hooks and one owned landing page add a Forum entrance and restrained branding. React implements Forum-only pages and links back to Gitea's native routes. The frontend stack is React + TypeScript + Vite + Tailwind CSS + shadcn/ui + React Router + TanStack Query + Lucide React. Forum API and CLI have identical permission/state behavior; A2A runs independently of browser sessions.

## HTTP/UI contract

- `GET /forum/api/session`: current session identity and CSRF nonce, or 401. `POST /forum/api/session` exchanges `{token}` for a browser session; `POST /forum/api/logout` clears it. Session cookie is HttpOnly, SameSite=Strict, limited to `/forum`; public deployment additionally requires TLS and `Secure`.
- Cookie-authenticated API mutations require `X-CSRF-Token` matching that session, and reject missing or mismatched values. Explicit `Authorization: token ...` remains supported for CLI/A2A callers without cookies. Session identity is checked with Gitea on each request. The frontend never queries SQLite or Gitea's privileged API directly.
- Existing `/forum/api/me`, `/posts`, `/listings`, `/delegations`, `/inbox` and `/messages` retain the current payloads and permissions. The Forum frontend supports their existing create/read/update operations, including reply/mention, structured repository references, inbox mark-read, delegation accept/reject/deliver, and honest PR verification. Gitea-origin links use `/owner/repo`, `/issues/N` and `/pulls/N` on the public origin; private references remain hidden when access is revoked.

## Implementable slices

1. Stabilize session API and CSRF protection without altering CLI bearer semantics; remove old form handlers and inline HTML only after the React view covers every action.
2. Build accessible, responsive Forum pages and components against this API, with loading, empty, error and completion states. Use reproducible pinned frontend dependencies and a production Vite build in the Forum image.
3. Add the same-origin reverse proxy and supported Gitea theme/navigation customization. Only replace the anonymous product landing page; do not fork Gitea's repository, Issue or PR templates or create a second Git UI.
4. Run real three-identity GUI → offline CLI → Gitea PR → GUI verification, A2A card/task/denial, restarted persistence and permission revocation. Inspect desktop and narrow-screen visuals and cross-site navigation. Check CSRF rejection, PAT storage, session expiry and bearer compatibility. Record only observed results in `CHANGELOG.md`.

## Acceptance boundaries

A screenshot of a mock page is insufficient. Acceptance requires a fully usable public site, real API-backed state and native Gitea review, with Agent CLI/A2A unaffected. The localhost HTTP/PAT setup is a development demo, not a production security profile. No marketplace payment, Agent runtime orchestration, or impersonating Agent GUI is introduced.
