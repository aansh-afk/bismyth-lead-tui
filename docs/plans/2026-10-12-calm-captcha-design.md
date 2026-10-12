# Calm browser verification

The user reports rapid clicking, flashing and wrong object choices after the 0.1.9 detector correction. Stop the current run through its SIGTERM cleanup handler, preserving progress and the contact profile. Do not run live flashing challenge experiments.

The existing per-element screenshots can scroll an iframe to each tile. Replace them with one viewport crop of the complete visible panel. Reject a partial, nested, occluded or canvas challenge instead of scrolling around it. Keep image freshness checks on the instruction and tile image identity/crop metadata, excluding hover and selection decorations. Recheck visibility and freshness after pauses and pacing waits immediately before each browser action.

Keep GPT-6 Luna low reasoning and saved ChatGPT authentication. Require precise requested-object interpretation and handoff on uncertainty. Limit the consequences of a bad answer: never apply an all-tile selection, stop if an answer repeats selected tiles, cap actual tile clicks at eighteen, and never repeat Verify on an unchanged challenge. Retain existing decision and time budgets. These guards do not prove semantic recognition accuracy.

Space browser actions by at least one second and allow 1.5 seconds of settling after a tile batch. Wire Runner checkpoints into the browser so P holds subsequent actions while S aborts pending waits/model work and closes Chrome. A dispatched browser action can finish before pause takes effect.

Validate using isolated headless fixtures: no element-screenshot calls or scrolling, all visibility boundaries, same-source image crop changes, hover tolerance, default spacing, no-progress/all-tile guards, pause with a changed challenge and stop mid-gap. Run existing integration/authentication tests and one real subscription call on a synthetic challenge. Release a tested tarball, upgrade the user's local installation and verify that personal configuration is unchanged. Live 99acres acceptance and broad object-recognition accuracy remain unverified.
