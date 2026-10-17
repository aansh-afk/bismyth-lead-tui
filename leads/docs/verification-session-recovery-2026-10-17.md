# WhatsApp contact recovery verification — 2026-10-17

## Problem and method

The reported screenshot showed the pre-live-search Contacts dialog. The installed primary command already contained v0.2.3 live search, but the oracle and oracle-leads aliases still pointed at the separate original Oracle checkout. The user's latest open process was verified to use the installed native frontend. Its service was disconnected, with one saved lead and no cached WhatsApp contacts.

A private SQLite recovery snapshot was made before reconnecting. The saved credentials contained a linked identity and app-state keys, despite `registered: false`. The pinned Baileys socket uses the saved `me` identity for login, so that flag alone did not mean the account was unpaired. Reconnecting the user's existing service and allowing its production contact-state synchronization loaded the directory. No fresh pairing, full message-history import, contact activation or customer send was performed by this recovery.

The fix resumes linked sessions at service startup while retaining the paused outreach default. Identity-bearing QR sessions are protected against accidental phone-code replacement or QR-switch credential deletion, and qualify for transient reconnect. All published command aliases now use the same package. Endpoint configuration remains available through `oracle configure-selfhost`.

Tests use injected Baileys sockets and isolated temporary SQLite stores. Native UI tests use real PTYs and the compiled frontend against a synthetic transport. Live checks report only counts and outcomes; customer names, phone numbers, auth and conversation text are omitted.

## Measured results

- Production reconnection: connected, contact-state ready; **242 directory contacts, including 241 WhatsApp contacts**. Before reconnection: one saved contact. Directory additions initially had zero active/consented contacts. No outgoing message was recorded.
- Targeted transport/service tests: **18/18 pass, 2.373 seconds**. New coverage exercises QR-linked identity recovery with a false registered flag, auth preservation, replacement rejection and service restart with outreach paused.
- Complete service regression: **60/60 pass, 8.980 seconds**.
- Native release build: **pass, 27.51 seconds**.
- Native synthetic directory regression: **15 SGR mouse clicks, 15.27 seconds**, 41 contacts, live search, filters, preview tabs, resize, stable selection, no permission changes or outgoing messages.
- Live native contact display, phone search, selected preview and 160×44 to 80×24 resize: **pass**. A final assertion expecting every contact to remain inactive failed because the operator enabled five contacts during the check. This is recorded as a concurrent-use limitation, not a passed no-change assertion. The live UI's provider selection paused outreach. No outgoing messages were recorded; operator-selected contact permissions were preserved. Further UI checks use isolated workspaces.

- Installed primary-command directory regression: **15 SGR mouse clicks, 15.59 seconds**, including live search, filters, previews and compact layout in an isolated workspace.
- Installed `oracle` alias: **pass**, startup provider choice, four real-service pages, Codex login status, resize, graceful shutdown and backup. All three command names report **0.2.4** and point into the same installed package; self-host configuration help remains available.
- Live SQLite final check: **242 contacts, five operator-enabled contacts, zero outgoing records; quick_check ok**.

## Limits and conclusion

The actual linked account successfully supplied contact metadata. This establishes the observed 241 shared contacts, not the completeness of the phone's entire address book. Automatic startup reconnect is covered by a real-service test with an injected socket; the operator's open live service was kept running rather than restarted during their work. Fresh QR and phone-code pairing, customer sends and external meeting delivery were not tested here.

Image rendering was researched using the maintained [ratatui-image documentation](https://github.com/ratatui/ratatui-image). Kitty, Sixel and iTerm2 protocols plus Unicode fallback are available, subject to terminal support. Raster image previews are not implemented in v0.2.4; see [image implementation notes](terminal-images.md).
