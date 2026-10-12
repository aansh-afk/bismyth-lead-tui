# Wait for image grids before audio fallback

The user confirmed that v0.1.6 selects audio before invoking Luna, then encounters a provider block. During image polling, the implementation treats the presence of an offered audio button as an active audio challenge. A second branch falls back immediately when an image panel appears before its grid tiles.

Wait within the existing bounded loading window for 9 or 16 visible tiles and loaded tile images. During this wait, only process audio if its answer field is already visible. An offered audio button remains a fallback after the image-loading window expires or an actual image decision fails. Preserve provider-block checks, deadlines, retry limits, cancellation and portal acceptance checks.

Send bounded solver-stage messages through the browser driver to the run activity log so the TUI explicitly reports Luna Low requests, image selections, Verify and audio fallback. Add Chromium regressions where audio is offered before delayed panel or tiles; the audio button leads to a block if clicked, while the image path succeeds. Validate those cases, saved activity and the existing suite; publish version 0.1.7. A running process must restart to load upgraded code.
