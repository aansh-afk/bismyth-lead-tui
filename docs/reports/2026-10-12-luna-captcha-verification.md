# GPT-6 Luna Low CAPTCHA verification

## Change and setup

Version 0.1.6 explicitly selects `gpt-6-luna` with `model_reasoning_effort="low"` for image CAPTCHA decisions. It uses the existing Codex CLI saved ChatGPT login; API-key and gateway overrides are removed from both login checks and execution. Text-only contact-control choices retain the CLI default. The separate Google audio helper is unchanged.

The local account model cache lists Luna, low reasoning, and image input. OpenAI's [model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) confirms image input and low reasoning, with no audio input; the [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents `model_reasoning_effort`. The installed CLI help confirms `--model`, TOML configuration overrides and ignored user configuration with saved authentication.

## Method

- TypeScript build and three focused fake-CLI tests validate exact model/effort arguments, forced ChatGPT auth, stripped credential overrides, 0700 temporary directories, 0600 schema/PNG permissions, original image bytes, and cleanup on success and failure. Text calls are checked for no model override.
- `BISMYTH_TEST_SUBSCRIPTION_VISION=1 npm test` runs the automated suite and enables the real subscription against a local synthetic 3×3 image challenge. The production screenshot → Codex → validated tiles → Chromium click → fixture acceptance → portal Proceed path is exercised. The fixture requests red squares in positions 1 and 3. All other portal tests use local fixtures or injected solvers.
- An independent read-only review checks model selection, authentication isolation, CLI syntax and audio/text scope.
- Package verification uses an isolated clean npm prefix and an isolated app data directory. No live property enquiries are sent.

## Results

The focused tests passed 3/3 in 686.633 ms, and TypeScript compilation passed. Independent review found no actionable issues.

The full suite with real subscription vision enabled passed **89 tests, 0 failures, 0 skipped**, in **71.688 seconds**. The real Luna Low synthetic challenge path passed in **16.402 seconds**, including browser screenshots, multiple model decisions, fixture provider acceptance and portal navigation. This is a single end-to-end observation, not a model latency benchmark.

The first package build in the standalone release checkout failed because that checkout lacked the TypeScript development dependency. Installing the locked dependencies with `npm ci --ignore-scripts` resolved the missing compiler.

The built npm tarball contains **26 entries** and is **65,044 bytes**. SHA-256: `55364153d474c7867e08d795f68097fb98107d1f7f1e78a87acdc8f61139c149`. A clean npm prefix installed version 0.1.6 with scripts disabled. The installed runtime contains the Luna Low arguments and the Python audio helper. Its doctor command, using isolated app data and the previously prepared private audio environment, reported Chrome, saved ChatGPT login and ready audio. `git diff --check` passed.

## Limits

A synthetic challenge proves the configured Luna Low image route and fixture integration, not real 99acres acceptance or a CAPTCHA success rate. A provider “Try again later” block offers no challenge to solve. Existing block detection and partial discovery fallback remain in effect. Audio acceptance and other live portal behaviour are not newly established by this update. Subscription usage and model access depend on the signed-in account.

## Requested run reset

The current stopped 100-project run was removed from local app storage. Its run JSON was deleted; no matching exports were present. The saved personal-profile configuration was preserved byte-for-byte, verified by matching SHA-256 before and after. Five other historical runs and the dedicated browser profile were retained. The application was inactive during deletion.
