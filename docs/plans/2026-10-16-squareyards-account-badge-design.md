# Square Yards account verification

The user shows an authenticated Square Yards My Portfolio page with visible Logout and a passive reCAPTCHA badge. The TUI incorrectly reports a security gate.

Fix the shared account observer: a passive invisible reCAPTCHA anchor/badge is not an active challenge. Retain blocking for visible challenge frames, checkbox widgets, other providers and explicit security headings/titles. Do not interact with any CAPTCHA.

Recognise Square Yards' official authenticated header and plain-div logout menu. For the user-provided portfolio layout, require its exact account route plus visible Profile, My Portfolio and Logout labels; neither URL, avatar nor guest navigation alone proves login. Keep all checks read-only and portal-specific.

Use local Chromium fixtures to verify passive badges, actual challenges, Square Yards authenticated/guest layouts, hidden menus and zero account/network/value-reading side effects. Run relevant account/controller checks and the existing suite, report limits, publish a patch and update the laptop without changing saved data. Square Yards remains a login-only integration.
