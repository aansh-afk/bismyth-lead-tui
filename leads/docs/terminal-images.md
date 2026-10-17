# Images in Oracle Leads

Research date: 2026-10-17. Image rendering is researched, not implemented in this release.

The native frontend uses Ratatui 0.29 and Crossterm. The maintained [ratatui-image](https://github.com/ratatui/ratatui-image) widget supports Kitty graphics, Sixel and iTerm2 graphics. It detects terminal capabilities and cell pixel dimensions with `Picker::from_query_stdio()`, with colored Unicode half-blocks as the fallback. Full raster support depends on the actual terminal; an embedded terminal may need the fallback.

For contact photos or shared image previews, keep decoded image/protocol state for the selected contact, reserve a stable rectangle, preserve aspect ratio, and offload resizing/encoding from the UI thread (`ThreadProtocol`). Hide previews when space is needed for usable contact text. Do not assume an unavailable profile photo is an error. Fetch only requested images, use bounded private caching and avoid committing customer media.

The current ratatui-image documentation must not be copied into the pinned Ratatui 0.29 frontend without first selecting a compatible crate version and checking its examples. An implementation should verify resize, page changes, image cleanup, unsupported terminal fallback and mouse hit regions in real terminal emulators. Existing QR rendering already uses Unicode blocks; it remains separate from raster photo support.

Primary references: [README and examples](https://github.com/ratatui/ratatui-image), [Picker capability detection](https://docs.rs/ratatui-image/latest/ratatui_image/picker/struct.Picker.html).
