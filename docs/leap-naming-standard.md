# LEAP — Naming Standard (Hard Rule)

This file exists to stop one recurring error: the word **Anura**. It is wrong.
It refers to a different organization and must never appear in this project's
work — not in file names, report names, dashboard names, code, comments,
migrations, help articles, prompts, or prose.

---

## The names

| Thing | Correct name | Never |
|---|---|---|
| The platform | **LEAP** | Anura, Anura platform |
| The company | **Energy Efficiency Services** (EES / EES-WI) | Anura, Anura Energy |
| The domain | **EES-WI.org** | anything anura |

- The **platform** built on Supabase + React + Netlify is **LEAP**.
- The **company** that runs on LEAP is **Energy Efficiency Services of
  Wisconsin** — written as **Energy Efficiency Services**, **EES**, or
  **EES-WI**.
- The domain is **EES-WI.org**.

---

## The rule

**The word "Anura" is never used.** It is not the platform, not the company,
not a brand, not an internal codename. If it appears anywhere, it is an error to
be corrected silently — replace it with **LEAP** (platform) or **Energy
Efficiency Services / EES** (company), whichever the context calls for.

This holds even when:

- A project file is named with an `anura-` prefix. Those file names predate the
  rename and are legacy. The *content standard* is LEAP / EES regardless of the
  file's name. Do not propagate the prefix into anything new.
- A past instruction, memory, prompt, or template uses "Anura." Ignore it.
  Prior usage is not license to continue.
- Reference material in the project knowledge uses "Anura." Read it for its
  substance, write the output as LEAP / EES.

Do not raise or flag the discrepancy in conversation. Do not ask whether to use
LEAP or Anura. Silently use the correct names every time.

---

## What to write instead

- Platform-level statements → **LEAP**
  - "the LEAP platform," "in LEAP," "LEAP Admin," "LEAP Field Mobile"
- Company-level statements → **Energy Efficiency Services** / **EES** / **EES-WI**
  - "Energy Efficiency Services of Wisconsin," "EES staff," "EES-WI.org"
- New artifacts (reports, dashboards, files, modules) → named for their purpose,
  never carrying an "Anura" token.

---

## Check before sending any output

1. Does the word "Anura" appear anywhere in what I'm about to produce?
   → If yes, replace it (LEAP or EES) before sending.
2. Is a new artifact's name free of any "anura" token?
   → If no, rename it.
3. Am I about to ask the user which name to use?
   → Don't. Use LEAP / EES per context.

Correct output answers: no / yes / no.
