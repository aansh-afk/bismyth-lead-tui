# Oracle Leads terminal redesign and mouse interaction

The user explicitly requested frontend-design guidance, a better terminal interface, mouse input and attention to the original Codex foundation. The terminal requirement and `bismyth-leads` command remain fixed.

Use a Rust Ratatui/Crossterm presentation layer: the same terminal libraries used by OpenAI Codex's open-source TUI. This is an independent outreach interface, not a claim to embed the entire Codex coding interface. Existing Codex CLI inference, local WhatsApp, permission checks and SQLite remain authoritative and unchanged.

Direction: quiet, dense, dark workspace. Slate surfaces, mint accent, restrained separators, clear typographic hierarchy and persistent context. Desktop terminal: 23-column navigation rail; flexible content; dashboard analytics/activity beside persistent operator chat; master-detail WhatsApp inbox; contact table with relationship context; grouped settings. Compact terminals use a horizontal navigation bar and one content region. No fabricated contacts or analytics.

Mouse contract: click navigation, controls, contact rows, menu choices and modal actions; scroll lists and conversation history using the wheel; click text fields to focus/place the cursor. Keyboard shortcuts and tab navigation remain available. Mutating actions use the same backend checks; mouse input never turns import or row selection into send authorization.

Provider picker, consent confirmation, exact message review, editor, import/export, meetings, source-backed memories and settings must remain usable. Escape closes a dialog without submitting. Editing prompts cannot change hard contact scope or opt-out policy. Test the actual compiled terminal via PTY with SGR mouse events, resize, keyboard actions and synthetic transport.
