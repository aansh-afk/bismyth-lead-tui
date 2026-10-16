# Housing/Quikr login verification and discovery access

The user reports completed Housing and Quikr logins remain unconfirmed, and asks for property discovery to use only selected portals that are logged in.

Retain the existing manual-login flow and read-only checks. Add the observed authenticated Quikr account marker and Housing's plain-div Log Out within its profile/account UI. Never infer login from a profile URL, hidden guest logout markup, cookies or runtime flags. Visible login/OTP/password controls and security gates override stale account markers. Add browser fixtures based on official shipped UI structures, including signed-out negatives and zero account actions.

Before creating a discovery run, intersect selected supported listing portals with confirmed signed-in observations in the account snapshot. Keep saved website preferences intact. Record skipped sites and create no discovery task when the intersection is empty; return the user to website login setup. Apply the same filtering to URL imports. Existing saved queues remain inspectable. Quikr and other login-only portals do not become discovery adapters through a login fix.

Verify account/browser/controller fixtures and the existing regression suite, write a results report, build/install a patch release, and publish source plus the npm-installable GitHub asset. Do not perform live enquiries, account submissions or WhatsApp sends.
