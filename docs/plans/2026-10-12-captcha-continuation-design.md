# Continue after browser verification

The user reports successful Chrome verification followed by a static handoff and `frame.frameElement: Frame has been detached`. Preserve the current browser page and saved contact profile. Separate provider acceptance from portal clearance.

Catch frame-disposal/navigation races during enumeration and re-read the live page. Recognize an enabled Proceed button on a verification gate even without a top-level token. If a token arrives before the portal callback, wait up to eight seconds for Proceed or gate clearance. Click Proceed once per continuation attempt, then require the gate to clear. Mere frame disappearance/checkbox state remains insufficient.

CAPTCHA-specific handoffs get a read-only one-second readiness observer. Automatically continue current-page preparation when the portal clears; generic OTP/terms handoffs remain operator-controlled. Cancel/suspend observers on Stop/Pause and invalidate stale results after C/K. Prevent automatic repeat attempts when Proceed did not clear the gate. Accept manual clearance after image attempt limits without invoking image inference.

Skip navigation when discovery's selected search seed already equals the current canonical URL. C preserves the current page; K explicitly moves on and may cause a new challenge.

Use headless local fixtures and fulfilled routes to recreate exact frame disposal, tokenless and delayed callbacks, stalled gates, search reloads, pause/Stop and stale observer races. Run the existing full suite, package v0.1.11 and install it on the user's PC. Avoid live challenge experiments and leave active browser sessions open during installation; the running TUI needs Q/relaunch to load new modules.
