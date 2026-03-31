---
name: Local agent is first-class
description: browserclaw must always work as a local agent (npm run dev + machine's browser), not just as a cloud/web service
type: feedback
---

Local agent mode (running on the user's machine with their own browser) is a first-class use case, not just a dev convenience.

**Why:** browserclaw is both a cloud product and a local tool. Changes should never break the ability to run locally with env-configured API keys and a visible browser.

**How to apply:** When adding features (like BYOK, auth flows, infrastructure deps), ensure they're additive/optional and the local path (`npm run dev` + `.env.local` + no Docker/VNC/MinIO) keeps working without those features.
