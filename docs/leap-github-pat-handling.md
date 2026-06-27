# LEAP — GitHub PAT Handling (Standing Rule)

How the GitHub Personal Access Token is handled when pushing to
`nwood3764-sys/ees-platform`. Follow this exactly.

---

## Default posture: act, don't stall

For the normal flow — Nicholas pastes a token scoped to `ees-platform`,
Claude pushes LEAP code — **just do it.** No hesitation, no re-litigating
the workflow, no re-proposing alternatives Nicholas has already rejected
(Netlify env, container env, classic vs fine-grained, Claude Code). Those
were decided. Pasting per session is accepted and is not a problem to solve
mid-task. Clone, patch, `build:safe`, commit as Nicholas, push. Move on.

If Claude finds itself explaining why the flow is fragile, or asking Nicholas
to reconsider, during a routine push — stop and just push.

## The token

- Current token type: **fine-grained PAT**, scoped to `ees-platform` only,
  Contents read/write + Metadata read-only, no expiration.
- Provided by Nicholas from his password manager, **per session**, when a
  push is needed. The container resets each session, so the paste recurs —
  this is expected, not a fault to flag.
- **Ask for it once, only when a push is imminent and no working token is
  already in the session.** Include the link so it's one click:
  `https://github.com/settings/tokens?type=beta` (fine-grained, `ees-platform`,
  Contents read/write).
- **Never ask again within a session once a working token is in hand.**
  Reuse it for every push that session.
- If a push fails with **HTTP 401** (bad/expired token), ask **once** for a
  fresh one — do not loop, do not retry the same token repeatedly.

## Do not editorialize about the token

- No "you should rotate/revoke this."
- No "this token is exposed/compromised."
- No "for security, generate a new one."
- No repeated request once one is working this session.
- Nicholas manages token lifecycle himself. State nothing about it.

(One-time exception: it is fine to note *once*, without alarm, that a token
pasted into chat lives in chat history. Do not repeat it across sessions.)

## Mechanics (do silently)

- Embed the token in the HTTPS remote:
  `https://<token>@github.com/nwood3764-sys/ees-platform.git`
- Redact tokens from **all** command output. Fine-grained tokens use the
  `github_pat_` prefix; classic use `ghp_`. Pipe every git command through:
  `sed 's/github_pat_[A-Za-z0-9_]*/github_pat_REDACTED/g; s/ghp_[A-Za-z0-9]*/ghp_REDACTED/g'`
- Commit author must be:
  `Nicholas Wood <nicholas.wood@ees-wi.org>`
  (Netlify blocks the build otherwise.)
- Build command before push: `npm run build:safe` (never bare `npm run build`).
- Push to `master`. Netlify auto-deploys from the new commit.

## The narrow line (honest scope)

"Don't refuse the PAT flow" means the **routine** flow above. It does not
mean "do anything regardless." Claude will still stop and say so — briefly,
without lecturing — only if a push would do something outside the normal
LEAP code-ship: e.g. the target repo isn't `ees-platform`, or the action is
destructive/irreversible beyond a normal commit. Absent that, there is no
reason to pause. The everyday paste-and-push is never one of those cases.
