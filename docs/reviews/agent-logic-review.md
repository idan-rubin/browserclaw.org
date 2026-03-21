# Agent Logic Code Review

**Date:** 2026-03-21
**Scope:** `src/Services/Browser/src/` — agent-loop, LLM integration, session management, skills

## Overall Assessment: Solid foundation, several gaps in robustness

The agent is well-designed for the happy path — simple browsing tasks on cooperative websites. The architecture (snapshot-driven loop, skill learning, anti-bot handling) is sound. However, there are meaningful reliability and flexibility concerns that will surface at scale.

---

## Reliability

### Strengths
- Snapshot retry with fallback (`safeSnapshot`) — graceful degradation when pages are loading
- Parse failure tolerance (3 consecutive) with reset on success — good resilience to LLM flakiness
- Loop detection prevents infinite repetition of broken actions
- Popup auto-dismissal before each step removes a common blocker
- Anti-bot handling (press-and-hold, Cloudflare) addresses real-world obstacles

### Concerns

1. **No MAX_STEPS limit** (`agent-loop.ts:265`). The loop is `for (let step = 0; ; step++)` — unbounded. The only termination paths are: `done`, `fail`, `abort`, or 3 consecutive parse failures. If the LLM keeps producing valid but useless actions, the agent loops forever until the session timeout (5 min). A hard step cap (e.g., 50-100) with a forced summary would prevent runaway sessions and wasted LLM spend.

2. **History grows without bound** (`agent-loop.ts:127-131`). Every step's reasoning is appended to the user message. After 30+ steps, the context window fills with history, leaving less room for the snapshot. There's no truncation, summarization, or sliding window. Long research tasks will degrade as history crowds out the current page content.

3. **`page` variable reassignment edge case** (`agent-loop.ts:431`). When `tabManager.checkForNewTab` returns a new page, the local `page` variable is reassigned. If the action *after* the tab switch in the same iteration fails, popup dismissal targets the old page for that iteration.

4. **No timeout on individual LLM calls**. If the LLM provider hangs, the entire agent stalls. The `llm.ts` layer has no request-level timeout — it relies entirely on the session max duration timeout to eventually kill the session.

5. **`executeAction` errors are swallowed** (`agent-loop.ts:411-423`). When an action fails, the error is logged and emitted, but the agent continues without the LLM knowing the action failed. The failed action is already recorded in history with its original reasoning, not the error.

6. **Snapshot fallback is too opaque** (`agent-loop.ts:91`). When both snapshot attempts fail, the agent receives `"[Snapshot unavailable — page may be loading]"`. The LLM has zero page context and will likely produce a nonsensical action. A better approach: return the last-known snapshot with a staleness marker.

---

## Robustness

### Strengths
- Anti-bot detection checks both DOM text and accessibility snapshot
- CDP-level mouse simulation for press-and-hold bypasses JS-level detection
- Cloudflare checkbox solver with polling and timeout
- Domain skill injection ("playbook") gives the agent a head start on known sites
- Tab management handles `target="_blank"` links automatically

### Concerns

7. **`detectAntiBot` logic has precedence issues** (`press-and-hold.ts:113-127`). The generic fallback at line 122-125 catches `press.*hold` in DOM text and maps it to `cloudflare_checkbox` — a wrong action type. If both snapshot and DOM contain "press hold", neither the first nor second check fires, and the third (generic) check dispatches the wrong solver.

8. **Popup dismissal can misfire** (`dismiss-popup.ts:68`). The dismiss pattern matches "accept", "agree", "continue" — often the *wrong* button on cookie consent banners (accepting all cookies rather than rejecting). The consent fallback clicks the *last* button, which is heuristic and site-dependent.

9. **No file download or upload support**. Chrome is launched with `--disable-downloads` and `--disable-file-system`. Tasks involving downloading PDFs, CSVs, or uploading files will fail silently.

10. **Single-page snapshot assumption**. For SPAs with heavy client-side rendering, the snapshot after an action may capture an intermediate state (loading spinners, skeleton screens). The fixed wait times don't adapt to actual page load completion.

11. **No `back` or `forward` navigation action**. The agent must know the previous URL to go back. Browser history navigation isn't exposed as an action type.

---

## Flexibility

### Strengths
- Multi-provider LLM support (OpenAI, Groq, Gemini, Anthropic)
- Configurable timing via env vars
- Skill learning loop (generate, save, improve, validate)
- `ask_user` action allows human-in-the-loop
- SSRF policy configurable

### Concerns

12. **LLM_MAX_TOKENS = 1024 is tight** (`config.ts:34`). For complex tasks with structured answers, 1024 tokens may truncate mid-JSON, causing parse failure. This is hardcoded, not configurable.

13. **No vision/screenshot capability**. The agent is purely text-based. It cannot interpret images, charts, CAPTCHAs (beyond Cloudflare checkbox), maps, or visually-rendered content.

14. **Domain skill keyed only by domain** (`skill-store.ts`). One skill per domain. Sites like amazon.com need different skills for different task types.

15. **No multi-tab orchestration**. The agent can't intentionally open new tabs or work across tabs simultaneously. Tab detection is reactive only.

16. **No `keyboard` action** for Enter, Escape, Tab, arrow keys. The `type` action only types text. No way to press Enter to submit forms or Escape to close dropdowns.

17. **The plan is generated but never referenced** (`agent-loop.ts:245-263`). The planning step creates a plan and emits it to the frontend, but never feeds it into subsequent agent steps. It's purely cosmetic.

---

## Test Coverage

Tests exist for: core loop, JSON parsing, skill generation, loop detection.

Missing coverage for:
- Anti-bot detection/handling
- Popup dismissal
- Tab management
- Session manager lifecycle
- LLM provider switching and OAuth refresh
- Error recovery paths

---

## Recommendations (Priority Order)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 1 | Add MAX_STEPS hard limit | Prevents runaway sessions & cost | Low |
| 2 | Add history truncation/summarization | Prevents context window exhaustion | Medium |
| 3 | Add per-LLM-call timeout | Prevents silent hangs | Low |
| 4 | Make LLM_MAX_TOKENS configurable | Unblocks complex answer generation | Low |
| 5 | Add `keyboard` action (Enter/Escape/Tab) | Unblocks form submission patterns | Low |
| 6 | Feed action errors back into history | Gives LLM explicit failure signals | Low |
| 7 | Add `back` navigation action | Enables natural browsing patterns | Low |
| 8 | Feed plan into agent context | Makes planning step useful | Medium |
| 9 | Fix anti-bot detection precedence | Prevents wrong solver dispatch | Low |
| 10 | Multi-skill-per-domain support | Better skill matching for complex sites | Medium |

---

## Bottom Line

The agent is effective for straightforward browsing tasks (search, fill form, extract data from a known site). The main gaps are around **long-running complex tasks** (unbounded steps + growing history) and **missing action primitives** (keyboard, back, downloads). Addressing items 1-6 would significantly improve reliability with minimal code changes.
