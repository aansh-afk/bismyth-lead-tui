# Approved CAPTCHA attempt flow

Use the existing Playwright browser and saved ChatGPT Codex login. Attempt reCAPTCHA checkboxes and visible 3×3/4×4 image grids, with private challenge-only screenshots and schema-validated tile choices. Never accept the model's claim of success. Check the provider's widget/token and, on a dedicated verification page, wait for the portal to leave that page. Attempts stop on blocked, unsupported or changed challenges and a bounded timeout. Existing manual handoff remains available.

## Implementation plan

1. Extract the existing structured subscription request into a reusable helper that can accept one image.
2. Add a bounded reCAPTCHA browser helper with injected image decisions for fixture testing.
3. Integrate it into discovery, contact preparation and post-submit verification, preserving explicit enquiry submission and conservative confirmation rules.
4. Test real Chromium fixtures for accepted/rejected checks, valid/invalid tile choices, stale challenges, cancellation and manual fallback. Probe image inference with the real subscription separately; report live portal limitations honestly.
5. Document supported challenges and package a patch release for installation.
