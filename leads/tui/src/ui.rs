use crate::app::*;
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Cell, Clear, Paragraph, Row, Table, TableState, Wrap},
};
use serde_json::{Value, json};
use unicode_width::UnicodeWidthStr;
pub const BG: Color = Color::Rgb(15, 18, 23);
pub const PANEL: Color = Color::Rgb(20, 24, 30);
pub const BORDER: Color = Color::Rgb(49, 57, 68);
pub const FG: Color = Color::Rgb(221, 227, 231);
pub const MUTED: Color = Color::Rgb(132, 145, 158);
pub const ACCENT: Color = Color::Rgb(133, 224, 186);
pub const SELECTED: Color = Color::Rgb(31, 52, 48);
pub const GOLD: Color = Color::Rgb(228, 190, 115);
const VERSION: &str = concat!("v", env!("CARGO_PKG_VERSION"));
pub fn safe(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .collect()
}
fn label(f: &mut Frame, area: Rect, s: impl Into<String>, color: Color) {
    f.render_widget(
        Paragraph::new(safe(&s.into())).style(Style::default().fg(color)),
        area,
    );
}
fn rect(x: u16, y: u16, w: u16, h: u16) -> Rect {
    Rect::new(x, y, w, h)
}
fn inset(r: Rect, x: u16, y: u16) -> Rect {
    Rect::new(
        r.x + x.min(r.width),
        r.y + y.min(r.height),
        r.width.saturating_sub(x * 2),
        r.height.saturating_sub(y * 2),
    )
}
fn panel(f: &mut Frame, area: Rect, title: &str) -> Rect {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(BORDER))
        .style(Style::default().bg(PANEL))
        .title(Line::from(vec![Span::styled(
            format!(" {} ", safe(title)),
            Style::default().fg(MUTED),
        )]));
    let inner = block.inner(area);
    f.render_widget(block, area);
    inner
}
fn button(
    f: &mut Frame,
    app: &mut App,
    x: u16,
    y: u16,
    label_text: &str,
    action: Action,
    primary: bool,
) -> u16 {
    let width = (UnicodeWidthStr::width(label_text) + 4) as u16;
    let area = rect(x, y, width, 1);
    f.render_widget(
        Paragraph::new(format!("  {label_text}  ")).style(
            Style::default()
                .fg(if primary { BG } else { FG })
                .bg(if primary { ACCENT } else { BORDER }),
        ),
        area,
    );
    app.hits.push((area, Hit::Action(action)));
    x + width + 1
}
fn wrap(value: &str, width: usize) -> Vec<String> {
    let mut output = vec![];
    let width = width.max(1);
    for source in safe(value).lines() {
        let mut line = String::new();
        for word in source.split_whitespace() {
            if !line.is_empty() && line.width() + word.width() + 1 > width {
                output.push(line);
                line = String::new();
            }
            if !line.is_empty() {
                line.push(' ');
            }
            for c in word.chars() {
                if line.width() + unicode_width::UnicodeWidthChar::width(c).unwrap_or(0) > width {
                    output.push(line);
                    line = String::new();
                }
                line.push(c);
            }
        }
        output.push(line);
    }
    if output.is_empty() {
        output.push(String::new());
    }
    output
}
fn history(f: &mut Frame, area: Rect, messages: &[Value], scroll: usize, operator: bool) {
    let mut lines: Vec<Line> = vec![];
    let width = area.width.saturating_sub(2) as usize;
    for m in messages {
        let incoming = if operator {
            strv(m, "role") != "user"
        } else {
            strv(m, "direction") == "in"
        };
        let who = if operator {
            if incoming { "ORACLE" } else { "YOU" }
        } else if incoming {
            "CONTACT"
        } else {
            "YOU"
        };
        let time = clip(strv(m, "created_at"), 16);
        lines.push(Line::from(vec![
            Span::styled(
                format!("{who}  "),
                Style::default()
                    .fg(if incoming { ACCENT } else { MUTED })
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("{} {}", time.get(11..).unwrap_or(""), strv(m, "status")),
                Style::default().fg(MUTED),
            ),
        ]));
        for line in wrap(strv(m, "text"), width) {
            lines.push(Line::from(Span::styled(line, Style::default().fg(FG))));
        }
        lines.push(Line::from(""));
    }
    if lines.is_empty() {
        lines = vec![
            Line::from(Span::styled(
                if operator {
                    "Your memory, one conversation away."
                } else {
                    "No messages in this relationship yet."
                },
                Style::default().fg(FG),
            )),
            Line::from(""),
            Line::from(Span::styled(
                if operator {
                    "Ask what happened last run, who wants a meeting, or what you promised a client."
                } else {
                    "Start the agent to introduce Atlas and answer enabled contacts automatically."
                },
                Style::default().fg(MUTED),
            )),
        ];
        f.render_widget(Paragraph::new(lines).wrap(Wrap { trim: false }), area);
        return;
    }
    let start = lines.len().saturating_sub(area.height as usize + scroll);
    let visible = lines
        .into_iter()
        .skip(start)
        .take(area.height as usize)
        .collect::<Vec<_>>();
    f.render_widget(Paragraph::new(visible), area);
}
fn nav(f: &mut Frame, app: &mut App, area: Rect, wide: bool) {
    let pages = [
        ("01", "Dashboard", "Overview & chat"),
        ("02", "WhatsApp", "Scoped inbox"),
        ("03", "Contacts", "People & memory"),
        ("04", "Settings", "Agent settings"),
        ("05", "Sources", "Find prospects"),
    ];
    if wide {
        let rail = Block::default()
            .style(Style::default().bg(PANEL))
            .borders(Borders::RIGHT)
            .border_style(Style::default().fg(BORDER));
        f.render_widget(rail, area);
        label(f, rect(area.x + 2, area.y + 1, 19, 1), "◈  ORACLE", ACCENT);
        label(f, rect(area.x + 5, area.y + 2, 16, 1), "L E A D S", FG);
        label(f, rect(area.x + 5, area.y + 3, 16, 1), VERSION, MUTED);
        label(f, rect(area.x + 2, area.y + 5, 18, 1), "WORKSPACE", MUTED);
        for (i, (number, name, description)) in pages.iter().enumerate() {
            let y = area.y + 7 + i as u16 * if area.height < 23 { 2 } else { 3 };
            let r = rect(area.x + 1, y, area.width - 2, 2);
            if i == app.page {
                f.render_widget(Block::default().style(Style::default().bg(SELECTED)), r);
            }
            label(
                f,
                rect(r.x + 1, y, r.width - 2, 1),
                format!("{number}  {name}"),
                if i == app.page { ACCENT } else { FG },
            );
            label(f, rect(r.x + 5, y + 1, r.width - 6, 1), *description, MUTED);
            app.hits
                .push((r, Hit::Action(Action::new("page", json!(i)))));
        }
        if area.height > 32 {
            let y = area.bottom() - 10;
            label(f, rect(area.x + 2, y, 18, 1), "MODEL", MUTED);
            label(
                f,
                rect(area.x + 2, y + 1, 18, 1),
                if strv(&app.state["settings"], "provider") == "codex" {
                    "Codex subscription"
                } else {
                    "Self-hosted model"
                },
                FG,
            );
            app.hits.push((
                rect(area.x + 1, y, area.width - 2, 3),
                Hit::Action(Action::new("provider", Value::Null)),
            ));
            label(f, rect(area.x + 2, y + 4, 18, 1), "WHATSAPP", MUTED);
            label(
                f,
                rect(area.x + 2, y + 5, 18, 1),
                strv(&app.state["whatsapp"], "status"),
                if strv(&app.state["whatsapp"], "status") == "connected" {
                    ACCENT
                } else {
                    GOLD
                },
            );
        }
        if area.height > 25 {
            label(
                f,
                rect(area.x + 2, area.bottom() - 3, 18, 1),
                "bismyth-leads",
                MUTED,
            );
        }
    } else {
        let width = (area.width / 5).max(1);
        for (i, (_, name, _)) in pages.iter().enumerate() {
            let r = rect(area.x + i as u16 * width, area.y, width, 2);
            f.render_widget(
                Paragraph::new(format!(" {} {name}", i + 1)).style(
                    Style::default()
                        .fg(if i == app.page { ACCENT } else { MUTED })
                        .bg(if i == app.page { SELECTED } else { PANEL }),
                ),
                r,
            );
            app.hits
                .push((r, Hit::Action(Action::new("page", json!(i)))));
        }
    }
}
pub fn draw(f: &mut Frame, app: &mut App) {
    let area = f.area();
    app.hits.clear();
    f.render_widget(Block::default().style(Style::default().bg(BG).fg(FG)), area);
    if area.width < 70 || area.height < 20 {
        label(
            f,
            inset(area, 2, 2),
            "Oracle Leads needs at least 70 × 20. Resize this terminal. Ctrl+C exits safely.",
            GOLD,
        );
        return;
    }
    let wide = area.width >= 110;
    let layout = Layout::vertical([
        Constraint::Length(if wide { 0 } else { 2 }),
        Constraint::Length(3),
        Constraint::Min(10),
        Constraint::Length(3),
    ])
    .split(area);
    let main = if wide {
        let regions = Layout::horizontal([Constraint::Length(23), Constraint::Min(40)])
            .split(rect(area.x, area.y, area.width, area.height - 3));
        nav(f, app, regions[0], true);
        rect(
            regions[1].x + 2,
            layout[1].y,
            regions[1].width - 4,
            layout[1].height + layout[2].height,
        )
    } else {
        nav(f, app, layout[0], false);
        rect(
            2,
            layout[1].y,
            area.width - 4,
            layout[1].height + layout[2].height,
        )
    };
    let title = [
        "Relationship overview",
        "WhatsApp workspace",
        "People & memory",
        "Workspace settings",
        "Prospect sources",
    ][app.page];
    label(
        f,
        rect(main.x, main.y, main.width.saturating_sub(34), 1),
        title,
        FG,
    );
    let paused = app.state["settings"]["automation_paused"]
        .as_bool()
        .unwrap_or(true);
    let controls = main.right().saturating_sub(31);
    button(
        f,
        app,
        controls,
        main.y,
        if paused {
            "▶ Start agent"
        } else {
            "Ⅱ Pause agent"
        },
        Action::new("toggle-agent", Value::Null),
        !paused,
    );
    button(
        f,
        app,
        main.right() - 9,
        main.y,
        "?",
        Action::new("help", Value::Null),
        false,
    );
    // Compact contact pages spend their spare title rows on search separation.
    let content_gap = if matches!(app.page, 1 | 2) && area.height < 28 {
        1
    } else {
        3
    };
    let content = rect(
        main.x,
        main.y + content_gap,
        main.width,
        main.height.saturating_sub(content_gap),
    );
    match app.page {
        0 => dashboard(f, app, content),
        1 | 2 => contacts(f, app, content),
        3 => settings(f, app, content),
        _ => sources(f, app, content),
    }
    let footer = layout[3];
    f.render_widget(
        Block::default()
            .borders(Borders::TOP)
            .border_style(Style::default().fg(BORDER)),
        footer,
    );
    let spinner = ["◐", "◓", "◑", "◒"][(app.tick / 3 % 4) as usize];
    let version_space = if wide { 0 } else { VERSION.len() as u16 + 2 };
    label(
        f,
        rect(2, footer.y + 1, area.width - 4 - version_space, 1),
        format!(
            "{}{}",
            if app.busy {
                format!("{spinner}  ")
            } else {
                String::new()
            },
            app.notice
        ),
        if app.busy { ACCENT } else { MUTED },
    );
    if !wide {
        label(
            f,
            rect(
                area.right() - 2 - VERSION.len() as u16,
                footer.y + 1,
                VERSION.len() as u16,
                1,
            ),
            VERSION,
            MUTED,
        );
    }
    label(
        f,
        rect(2, footer.y + 2, area.width - 4, 1),
        if app.search_focus {
            "Live search · ↑↓ select results · Enter / Esc leave search · Clear resets · Click a contact to preview"
        } else if app.composer_focus {
            "Enter send question · Esc leave composer · Tab focus · Mouse click & scroll"
        } else {
            "1–5 pages · ↑↓ select · Enter actions · Space agent · Tab focus · ? help · Q quit"
        },
        MUTED,
    );
    if app.modal.is_some() {
        app.hits.clear();
        modal(f, app, area);
    }
}
fn dashboard(f: &mut Frame, app: &mut App, area: Rect) {
    let s = app.state.clone();
    let a = &s["analytics"];
    let regions = Layout::vertical([
        Constraint::Length(5),
        Constraint::Length(2),
        Constraint::Min(6),
    ])
    .split(area);
    let metrics = Layout::horizontal([Constraint::Fill(1); 5])
        .spacing(1)
        .split(regions[0]);
    for (i, (key, title)) in [
        ("contacts", "RELATIONSHIPS"),
        ("interested", "INTERESTED"),
        ("meeting_requests", "WANT A MEETING"),
        ("meetings", "BOOKED"),
        ("clients", "CLIENTS"),
    ]
    .iter()
    .enumerate()
    {
        let r = metrics[i];
        let inner = panel(f, r, title);
        label(
            f,
            inset(inner, 1, 0),
            num(a, key).to_string(),
            if i == 1 { ACCENT } else { FG },
        );
        if inner.height > 1 {
            label(
                f,
                rect(inner.x + 1, inner.y + 2, inner.width - 2, 1),
                [
                    "in your workspace",
                    "positive responses",
                    "awaiting next step",
                    "local meetings",
                    "relationship stage",
                ][i],
                MUTED,
            );
        }
    }
    let active = list(&s, "runs")
        .into_iter()
        .find(|r| r["id"] == s["run_id"])
        .map(|r| r["active_seconds"].as_f64().unwrap_or(0.0))
        .unwrap_or(0.0);
    label(
        f,
        regions[1],
        format!(
            "{} sent  ·  {} replies  ·  {} actions underway  ·  {:.1} min active  ·  {}",
            num(a, "sent"),
            num(a, "replies"),
            num(a, "working"),
            active / 60.0,
            strv(&s["agent_status"], "summary")
        ),
        MUTED,
    );
    let wide = area.width >= 94;
    let split = Layout::horizontal(if wide {
        vec![Constraint::Percentage(50), Constraint::Percentage(50)]
    } else {
        vec![Constraint::Length(0), Constraint::Fill(1)]
    })
    .spacing(if wide { 1 } else { 0 })
    .split(regions[2]);
    if wide {
        let left = Layout::vertical([Constraint::Min(5), Constraint::Length(4)])
            .spacing(1)
            .split(split[0]);
        let r = panel(f, left[0], "RECENT ACTIVITY");
        let mut lines = vec![];
        for event in list(&s, "activity")
            .into_iter()
            .take((r.height / 2).max(1) as usize)
        {
            let time = strv(&event, "created_at").get(11..16).unwrap_or("");
            lines.push(Line::from(vec![
                Span::styled(format!("{time}  "), Style::default().fg(MUTED)),
                Span::styled(
                    clip(strv(&event, "detail"), r.width.saturating_sub(8) as usize),
                    Style::default().fg(FG),
                ),
            ]));
            lines.push(Line::from(""));
        }
        f.render_widget(Paragraph::new(lines), inset(r, 1, 0));
        let b = panel(f, left[1], "FOLLOW THROUGH");
        let mut x = b.x + 1;
        x = button(
            f,
            app,
            x,
            b.y + 1,
            "Meetings",
            Action::new("meetings", json!(false)),
            false,
        );
        if x + 16 < b.right() {
            button(
                f,
                app,
                x,
                b.y + 1,
                "Run history",
                Action::new("runs", Value::Null),
                false,
            );
        }
        app.hits.push((r, Hit::Transcript));
    }
    let right = Layout::vertical([Constraint::Min(4), Constraint::Length(4)]).split(split[1]);
    let h = panel(f, right[0], "ORACLE  /  YOUR WORKSPACE ASSISTANT");
    history(f, inset(h, 1, 0), &list(&s, "chat"), app.chat_scroll, true);
    app.hits.push((h, Hit::Transcript));
    let input = right[1];
    let color = if app.composer_focus { ACCENT } else { BORDER };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(color))
        .title(" Ask Oracle ");
    let inner = block.inner(input);
    f.render_widget(block, input);
    let width = inner.width.saturating_sub(10) as usize;
    let (lines, cursor, _) = app.composer.wrapped(width);
    let offset = cursor
        .0
        .saturating_sub(inner.height.saturating_sub(1) as usize);
    let contents = if app.composer.value.is_empty() {
        "What happened in the previous run?".into()
    } else {
        lines
            .iter()
            .skip(offset)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    };
    label(
        f,
        rect(
            inner.x + 1,
            inner.y,
            inner.width.saturating_sub(10),
            inner.height,
        ),
        contents,
        if app.composer.value.is_empty() {
            MUTED
        } else {
            FG
        },
    );
    app.hits.push((inner, Hit::Composer(inner, offset)));
    button(
        f,
        app,
        input.right() - 9,
        input.y + 1,
        "Send",
        Action::new("send-chat", Value::Null),
        true,
    );
    if app.composer_focus {
        f.set_cursor_position((
            inner.x + 1 + cursor.1.min(width) as u16,
            inner.y + (cursor.0 - offset) as u16,
        ));
    }
}
fn contacts(f: &mut Frame, app: &mut App, area: Rect) {
    let whatsapp = app.page == 1;
    let s = app.state.clone();
    let header = Layout::vertical([Constraint::Length(7), Constraint::Min(5)]).split(area);
    let mut x = header[0].x;
    if whatsapp {
        x = button(
            f,
            app,
            x,
            header[0].y,
            if s["whatsapp"]["relogin_required"].as_bool().unwrap_or(false) {
                "Relogin"
            } else {
                "Connect / QR"
            },
            Action::new(
                if s["whatsapp"]["relogin_required"].as_bool().unwrap_or(false) {
                    "relogin"
                } else {
                    "connect"
                },
                Value::Null,
            ),
            strv(&s["whatsapp"], "status") != "connected",
        );
        x = button(
            f,
            app,
            x,
            header[0].y,
            "Enter phone number",
            Action::new("pair-phone", Value::Null),
            false,
        );
        x = button(
            f,
            app,
            x,
            header[0].y,
            "Disconnect",
            Action::new("disconnect", Value::Null),
            false,
        );
        if x + 10 < header[0].right() {
            button(
                f,
                app,
                x,
                header[0].y,
                "Unlink",
                Action::new("unlink", Value::Null),
                false,
            );
        }
    } else {
        x = button(
            f,
            app,
            x,
            header[0].y,
            "Import",
            Action::new("import", Value::Null),
            true,
        );
        x = button(
            f,
            app,
            x,
            header[0].y,
            "Export",
            Action::new("export", Value::Null),
            false,
        );
        x = button(
            f,
            app,
            x,
            header[0].y,
            "Find",
            Action::new("search", Value::Null),
            false,
        );
        if x + 15 < header[0].right() {
            x = button(
                f,
                app,
                x,
                header[0].y,
                "Older runs",
                Action::new("legacy", Value::Null),
                false,
            );
        }
        if x + 21 < header[0].right() {
            button(
                f,
                app,
                x,
                header[0].y,
                if strv(&s["whatsapp"], "status") == "connected" {
                    "Refresh WhatsApp"
                } else {
                    "Connect WhatsApp"
                },
                if strv(&s["whatsapp"], "status") == "connected" {
                    Action::new("refresh-contacts", Value::Null)
                } else {
                    Action::new("page", json!(1))
                },
                false,
            );
        }
    }
    let source_hint = if whatsapp {
        format!(
            "{}  {} · {}",
            strv(&s["whatsapp"], "status").to_uppercase(),
            if strv(&s["whatsapp"], "phone").is_empty() {
                "No account paired"
            } else {
                strv(&s["whatsapp"], "phone")
            },
            strv(&s["agent_status"], "summary")
        )
    } else {
        let known = list(&s, "contacts")
            .iter()
            .filter(|c| c["whatsapp_known"].as_bool().unwrap_or(false))
            .count();
        if !strv(&s["whatsapp"], "directory_error").is_empty() {
            strv(&s["whatsapp"], "directory_error").into()
        } else if strv(&s["directory"]["legacy"], "status") == "error" {
            strv(&s["directory"]["legacy"], "error").into()
        } else if strv(&s["whatsapp"], "directory_status") == "syncing" {
            "Receiving available WhatsApp contact updates…".into()
        } else if strv(&s["whatsapp"], "directory_status") == "waiting_for_keys" {
            "WhatsApp contact sync is waiting for your phone. Keep it online, then Refresh WhatsApp.".into()
        } else {
            format!(
                "Saved leads + WhatsApp contacts · {known} shared by WhatsApp · Listing does not enable outreach"
            )
        }
    };
    label(
        f,
        rect(header[0].x, header[0].y + 1, header[0].width, 1),
        source_hint,
        MUTED,
    );
    let search = rect(
        header[0].x,
        header[0].y + 3,
        header[0].width.saturating_sub(10),
        1,
    );
    f.render_widget(
        Block::default().style(Style::default().bg(if app.search_focus {
            SELECTED
        } else {
            PANEL
        })),
        search,
    );
    let width = search.width.saturating_sub(2) as usize;
    let (lines, cursor, _) = app.search_editor.wrapped(width);
    let shown = if app.search.is_empty() {
        "Search name, phone, company…  /".into()
    } else {
        lines.get(cursor.0).cloned().unwrap_or_default()
    };
    label(
        f,
        rect(search.x + 1, search.y, search.width.saturating_sub(2), 1),
        shown,
        if app.search.is_empty() { MUTED } else { FG },
    );
    app.hits.push((search, Hit::Search(search, cursor.0)));
    if app.search_focus {
        f.set_cursor_position((
            search.x + 1 + cursor.1.min(width.saturating_sub(1)) as u16,
            search.y,
        ));
    }
    button(
        f,
        app,
        header[0].right() - 9,
        search.y,
        "Clear",
        Action::new("clear-search", Value::Null),
        false,
    );
    let mut fx = header[0].x;
    for (name, key) in [
        ("All", "all"),
        ("Enabled", "enabled"),
        ("WhatsApp", "whatsapp"),
        ("Saved", "saved"),
    ] {
        fx = button(
            f,
            app,
            fx,
            header[0].y + 5,
            name,
            Action::new("filter", json!(key)),
            app.contact_filter == key,
        );
    }
    let rows = app.contacts();
    let count = rows.len();
    if fx + 15 < header[0].right() {
        label(
            f,
            rect(fx + 1, header[0].y + 5, header[0].right() - fx - 1, 1),
            format!("{count} results"),
            MUTED,
        );
    }
    let split = Layout::horizontal(if area.width >= 94 {
        vec![
            Constraint::Percentage(if whatsapp { 37 } else { 55 }),
            Constraint::Fill(1),
        ]
    } else {
        vec![Constraint::Percentage(43), Constraint::Fill(1)]
    })
    .spacing(1)
    .split(header[1]);
    let table_area = panel(
        f,
        split[0],
        &format!(
            "{} · {}",
            if whatsapp { "SCOPED INBOX" } else { "CONTACTS" },
            count
        ),
    );
    if rows.is_empty() {
        let filtered = !app.search.is_empty() || app.contact_filter != "all";
        let text = if filtered {
            "No matching contacts.\n\nTry a name, company or phone number. Clear resets the search and source filter."
        } else if whatsapp {
            "No active conversations.\n\nPair your number, then explicitly enable selected contacts from Contacts."
        } else {
            "Your relationship workspace is empty.\n\nConnect WhatsApp to receive available contacts, use Older runs, or import a CSV."
        };
        f.render_widget(
            Paragraph::new(text)
                .style(Style::default().fg(MUTED))
                .wrap(Wrap { trim: true }),
            inset(table_area, 1, 0),
        );
        let right = panel(f, split[1], "CONTACT PREVIEW");
        f.render_widget(Paragraph::new("Select a result to see their details, conversation and permanent memory.\n\nBrowsing never activates a contact or sends a message.").style(Style::default().fg(MUTED)).wrap(Wrap{trim:true}),inset(right,1,0));
        return;
    }
    let compact = table_area.width < 65;
    let data = rows
        .iter()
        .map(|c| {
            let access = if num(c, "opted_out") == 1 {
                "opted out"
            } else if num(c, "active") == 1 {
                "enabled"
            } else {
                "listed only"
            };
            if compact {
                Row::new(vec![Cell::from(ratatui::text::Text::from(vec![
                    Line::from(safe(strv(c, "name"))),
                    Line::styled(safe(strv(c, "phone")), Style::default().fg(MUTED)),
                ]))])
                .height(2)
            } else {
                Row::new(vec![
                    Cell::from(safe(strv(c, "name"))),
                    Cell::from(safe(strv(c, "phone"))),
                    Cell::from(safe(strv(c, "company"))),
                    Cell::from(safe(strv(c, "stage"))),
                    Cell::from(access),
                ])
                .height(1)
            }
        })
        .collect::<Vec<_>>();
    let widths = if compact {
        vec![Constraint::Fill(1)]
    } else {
        vec![
            Constraint::Fill(2),
            Constraint::Length(16),
            Constraint::Fill(2),
            Constraint::Length(12),
            Constraint::Length(11),
        ]
    };
    let titles = if compact {
        vec!["Name / phone"]
    } else {
        vec!["Name", "Phone", "Company", "Stage", "Access"]
    };
    let mut state = TableState::default().with_selected(Some(app.row.min(rows.len() - 1)));
    let table = Table::new(data, widths)
        .header(
            Row::new(titles)
                .style(Style::default().fg(MUTED))
                .bottom_margin(1),
        )
        .row_highlight_style(Style::default().bg(SELECTED).fg(ACCENT))
        .highlight_symbol("› ");
    f.render_stateful_widget(table, table_area, &mut state);
    let offset = state.offset();
    let row_height = if compact { 2 } else { 1 };
    for i in offset..rows.len() {
        let y = table_area.y + 2 + (i - offset) as u16 * row_height;
        if y + row_height > table_area.bottom() {
            break;
        }
        app.hits.push((
            rect(table_area.x, y, table_area.width, row_height),
            Hit::Contact(i),
        ));
    }
    app.hits.push((table_area, Hit::List));
    let c = app.contact();
    if c.is_null() {
        let r = panel(f, split[1], "CONTACT PREVIEW");
        label(
            f,
            r,
            "Contact details are unavailable. Refresh to try again.",
            GOLD,
        );
        return;
    }
    let pieces = Layout::vertical([
        Constraint::Length(4),
        Constraint::Length(1),
        Constraint::Min(3),
        Constraint::Length(1),
    ])
    .split(split[1]);
    let heading = panel(f, pieces[0], &clip(strv(&c, "name"), 36));
    label(
        f,
        rect(heading.x + 1, heading.y, heading.width.saturating_sub(2), 1),
        format!("{} · {}", strv(&c, "phone"), strv(&c, "stage")),
        MUTED,
    );
    label(
        f,
        rect(
            heading.x + 1,
            heading.y + 1,
            heading.width.saturating_sub(2),
            1,
        ),
        format!("{} {}", strv(&c, "company"), strv(&c, "role")),
        FG,
    );
    let mut tx = pieces[1].x;
    for (i, name) in ["Overview", "Chat", "Memory"].iter().enumerate() {
        tx = button(
            f,
            app,
            tx,
            pieces[1].y,
            name,
            Action::new("detail-tab", json!(i)),
            app.detail_tab == i,
        );
    }
    if app.detail_tab == 1 {
        let content = panel(f, pieces[2], "CONVERSATION");
        history(
            f,
            inset(content, 1, 0),
            &list(&app.detail, "messages"),
            app.thread_scroll,
            false,
        );
        app.hits.push((content, Hit::Transcript));
    } else {
        let content = panel(
            f,
            pieces[2],
            if app.detail_tab == 2 {
                "PERMANENT MEMORY"
            } else {
                "RELATIONSHIP MEMORY"
            },
        );
        let mut lines = vec![];
        let mut add = |title: &str, value: String| {
            lines.push(Line::from(Span::styled(
                title.to_owned(),
                Style::default().fg(ACCENT),
            )));
            lines.extend(
                wrap(&value, content.width.saturating_sub(2) as usize)
                    .into_iter()
                    .map(Line::from),
            );
            lines.push(Line::from(""));
        };
        if app.detail_tab == 0 {
            let access = if num(&c, "opted_out") == 1 {
                "Opted out · outreach stopped"
            } else if num(&c, "active") == 1 {
                "Enabled · sender permission recorded"
            } else {
                "Listed only · outreach is paused for this contact"
            };
            add("ACCESS", access.into());
            add(
                "NEXT ACTION",
                if strv(&c, "next_action").is_empty() {
                    "No next action recorded".into()
                } else {
                    format!("{}\n{}", strv(&c, "next_action"), strv(&c, "followup_at"))
                },
            );
            if !strv(&c, "notes").is_empty() {
                add("NOTES", strv(&c, "notes").into());
            }
            add("SOURCE", strv(&c, "source").into());
        }
        if list(&app.detail, "memories").is_empty() {
            add(
                "PERMANENT MEMORY",
                "No facts saved yet. Add a note from Actions.".into(),
            );
        } else {
            lines.push(Line::from(Span::styled(
                "PERMANENT MEMORY",
                Style::default().fg(ACCENT),
            )));
        }
        for m in list(&app.detail, "memories") {
            lines.extend(
                wrap(
                    strv(&m, "content"),
                    content.width.saturating_sub(2) as usize,
                )
                .into_iter()
                .map(Line::from),
            );
            lines.push(Line::from(Span::styled(
                if strv(&m, "source_id").is_empty() {
                    strv(&m, "kind").to_owned()
                } else {
                    format!(
                        "{} · source {}",
                        strv(&m, "kind"),
                        clip(strv(&m, "source_id"), 8)
                    )
                },
                Style::default().fg(MUTED),
            )));
            lines.push(Line::from(""));
        }
        f.render_widget(
            Paragraph::new(lines)
                .style(Style::default().fg(FG))
                .scroll((app.thread_scroll.min(u16::MAX as usize) as u16, 0)),
            inset(content, 1, 0),
        );
        app.hits.push((content, Hit::Transcript));
    }
    let mut ax = pieces[3].x;
    ax = button(
        f,
        app,
        ax,
        pieces[3].y,
        "Write",
        Action::new("write", Value::Null),
        true,
    );
    ax = button(
        f,
        app,
        ax,
        pieces[3].y,
        "Activity",
        Action::new("jobs", Value::Null),
        false,
    );
    button(
        f,
        app,
        ax,
        pieces[3].y,
        "Actions",
        Action::new("contact-actions", Value::Null),
        false,
    );
}
fn sources(f: &mut Frame, app: &mut App, area: Rect) {
    let parts = Layout::vertical([
        Constraint::Length(if area.width < 110 { 7 } else { 5 }),
        Constraint::Min(5),
        Constraint::Length(2),
    ])
    .split(area);
    let info = app.state["sources"].clone();
    let mut x = parts[0].x;
    let mut y = parts[0].y;
    for (title, action) in [
        ("Search web", "source-search"),
        ("Scrape URL", "source-scrape"),
        ("Crawl site", "source-crawl"),
        ("Collect", "source-collect"),
        ("Contacts", "source-all-contacts"),
        ("Companies", "source-companies"),
        ("Manage", "source-manage"),
        ("Configure", "source-key"),
        ("Runs", "source-runs"),
        ("Credits", "source-credits"),
    ] {
        if x + title.len() as u16 + 4 > parts[0].right() {
            x = parts[0].x;
            y += 2;
        }
        x = button(f, app, x, y, title, Action::new(action, Value::Null), false);
    }
    label(
        f,
        rect(parts[0].x, parts[0].bottom() - 1, parts[0].width, 1),
        format!(
            "Firecrawl {} · {} sources · {} contacts · last credits {}{}",
            if info["configured"].as_bool().unwrap_or(false) {
                "configured"
            } else {
                "needs API key"
            },
            num(&info, "count"),
            num(&info, "contact_count"),
            info["balance"]["remaining"]
                .as_i64()
                .map(|n| n.to_string())
                .unwrap_or("not checked".into()),
            if info["busy"].as_bool().unwrap_or(false) {
                " · researching…"
            } else {
                ""
            }
        ),
        MUTED,
    );
    let panes = if area.width >= 95 {
        Layout::horizontal([Constraint::Percentage(42), Constraint::Percentage(58)])
            .spacing(1)
            .split(parts[1])
    } else {
        Layout::vertical([Constraint::Percentage(45), Constraint::Percentage(55)]).split(parts[1])
    };
    let left = panel(f, panes[0], "SAVED SOURCES");
    let right = panel(f, panes[1], "SOURCE & CONTACT EVIDENCE");
    app.hits.push((left, Hit::List));
    let pages = app.source_pages();
    if pages.is_empty() {
        label(
            f,
            inset(left, 1, 1),
            "Find brokerage owners and businesses.\n\nSearch the web, scrape a URL or crawl a website. Your sources stay here between runs.",
            MUTED,
        );
    } else {
        let rows = left.height as usize;
        let start = app.row.saturating_sub(rows.saturating_sub(1));
        for (i, p) in pages.iter().enumerate().skip(start).take(rows) {
            let row = rect(left.x, left.y + (i - start) as u16, left.width, 1);
            label(
                f,
                row,
                format!(
                    "{} {} · {}",
                    if i == app.row { "›" } else { " " },
                    strv(p, "title"),
                    strv(p, "status")
                ),
                if i == app.row { ACCENT } else { FG },
            );
            app.hits.push((row, Hit::Contact(i)));
        }
    }
    if app.detail.is_null() {
        label(
            f,
            inset(right, 1, 1),
            "Select a source to see its URL, page content and public phone/email evidence.",
            MUTED,
        );
    } else {
        let p = &app.detail;
        let candidates = list(p, "candidates");
        let emails = list(p, "emails");
        let mut content = format!(
            "{}\n{}\n{} · {}\n\n{}\n\nCONTACTS & COMPANIES\n",
            strv(p, "title"),
            strv(p, "url"),
            strv(p, "status"),
            clip(strv(p, "updated_at"), 16),
            strv(p, "description")
        );
        if candidates.is_empty() {
            content.push_str("No verified-format phone candidates yet. Inspect the page or crawl its contact pages.\n");
        }
        for c in candidates {
            content.push_str(&format!(
                "{} · {}\nCompany: {}\nPhone: {}  Email: {}\nEvidence: {}\n\n",
                if strv(&c, "name").is_empty() {
                    "Name not stated"
                } else {
                    strv(&c, "name")
                },
                strv(&c, "role"),
                if strv(&c, "company").is_empty() {
                    "Not stated"
                } else {
                    strv(&c, "company")
                },
                strv(&c, "phone"),
                strv(&c, "email"),
                strv(&c, "evidence")
            ));
        }
        if !emails.is_empty() {
            content.push_str("\nEMAILS\n");
            for e in emails {
                content.push_str(e.as_str().unwrap_or(""));
                content.push('\n');
            }
        }
        content.push_str("\nPAGE CONTENT\n");
        content.push_str(&clip(strv(p, "markdown"), 20000));
        let lines = wrap(&content, right.width.saturating_sub(2) as usize);
        f.render_widget(
            Paragraph::new(lines.into_iter().map(Line::from).collect::<Vec<_>>())
                .scroll((app.thread_scroll.min(u16::MAX as usize) as u16, 0))
                .style(Style::default().fg(FG)),
            inset(right, 1, 0),
        );
        app.hits.push((right, Hit::Transcript));
    }
    let x = button(
        f,
        app,
        parts[2].x,
        parts[2].y,
        "Actions",
        Action::new("source-actions", Value::Null),
        false,
    );
    button(
        f,
        app,
        x,
        parts[2].y,
        "Page contacts",
        Action::new("source-contacts", Value::Null),
        true,
    );
}
fn settings(f: &mut Frame, app: &mut App, area: Rect) {
    let parts = Layout::vertical([
        Constraint::Length(2),
        Constraint::Min(7),
        Constraint::Length(3),
    ])
    .split(area);
    label(
        f,
        parts[0],
        "Instructions shape the conversation. Contact scope stays enforced in code.",
        MUTED,
    );
    let r = panel(f, parts[1], "AGENT & WORKSPACE");
    let settings = app.settings();
    let visible = r.height as usize;
    let start = app.settings_row.saturating_sub(visible.saturating_sub(1));
    for (i, (label_text, value, key)) in settings.iter().enumerate().skip(start).take(visible) {
        let row = rect(r.x + 1, r.y + (i - start) as u16, r.width - 2, 1);
        if i == app.settings_row {
            f.render_widget(Block::default().style(Style::default().bg(SELECTED)), row);
        }
        let columns = Layout::horizontal([
            Constraint::Length(27.min(row.width / 2)),
            Constraint::Fill(1),
        ])
        .split(row);
        label(
            f,
            columns[0],
            format!(" {}", label_text),
            if i == app.settings_row { ACCENT } else { FG },
        );
        label(
            f,
            columns[1],
            if value.is_empty() {
                "Not configured".into()
            } else {
                value.clone()
            },
            MUTED,
        );
        app.hits
            .push((row, Hit::Action(Action::new("setting", json!(key)))));
    }
    let mut x = parts[2].x;
    x = button(
        f,
        app,
        x,
        parts[2].y + 1,
        "Verify provider",
        Action::new("verify", Value::Null),
        false,
    );
    x = button(
        f,
        app,
        x,
        parts[2].y + 1,
        "Backup",
        Action::new("backup", Value::Null),
        false,
    );
    if x + 13 < parts[2].right() {
        button(
            f,
            app,
            x,
            parts[2].y + 1,
            "Restore",
            Action::new("restore", Value::Null),
            false,
        );
    }
}
fn modal(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(dialog) = app.modal.clone() else {
        return;
    };
    let (width, height) = match &dialog {
        Modal::Qr => (area.width.saturating_sub(4), area.height.saturating_sub(2)),
        Modal::Menu { items, .. } => (
            90.min(area.width - 4),
            (items.len() as u16 + 8).min(area.height - 4),
        ),
        Modal::Form { fields, .. } => (
            88.min(area.width - 4),
            (fields
                .iter()
                .map(|field| if field.multiline { 10 } else { 3 })
                .sum::<u16>()
                + 8)
            .min(area.height - 2),
        ),
        Modal::Confirm { .. } => (84.min(area.width - 4), 18.min(area.height - 4)),
        Modal::Help => (84.min(area.width - 4), 23.min(area.height - 4)),
    };
    let r = rect(
        area.x + (area.width - width) / 2,
        area.y + (area.height - height) / 2,
        width,
        height,
    );
    f.render_widget(Clear, r);
    let title = match &dialog {
        Modal::Menu { title, .. } | Modal::Form { title, .. } | Modal::Confirm { title, .. } => {
            title.as_str()
        }
        Modal::Qr => "Link your WhatsApp account",
        Modal::Help => "Oracle Leads · workspace controls",
    };
    let inner = panel(f, r, title);
    let inner = inset(inner, 1, 0);
    match dialog {
        Modal::Menu {
            hint,
            items,
            selected,
            ..
        } => {
            let hints = wrap(&hint, inner.width as usize);
            let hh = hints.len().min(2) as u16;
            label(
                f,
                rect(inner.x, inner.y, inner.width, hh),
                hints.into_iter().take(2).collect::<Vec<_>>().join("\n"),
                MUTED,
            );
            let body = rect(
                inner.x,
                inner.y + hh + 1,
                inner.width,
                inner.height.saturating_sub(hh + 3),
            );
            let visible = body.height as usize;
            let start = selected.saturating_sub(visible.saturating_sub(1));
            for (i, (label_text, _)) in items.iter().enumerate().skip(start).take(visible) {
                let row = rect(body.x, body.y + (i - start) as u16, body.width, 1);
                f.render_widget(
                    Paragraph::new(format!(
                        "{} {}",
                        if i == selected { "›" } else { " " },
                        safe(label_text)
                    ))
                    .style(
                        Style::default()
                            .fg(if i == selected { ACCENT } else { FG })
                            .bg(if i == selected { SELECTED } else { PANEL }),
                    ),
                    row,
                );
                app.hits.push((row, Hit::Menu(i)));
            }
            label(
                f,
                rect(inner.x, inner.bottom() - 1, inner.width, 1),
                "↑↓ select · Enter open · Click a row · Esc back",
                MUTED,
            );
        }
        Modal::Form {
            hint,
            fields,
            focus,
            kind,
            ..
        } => {
            label(
                f,
                rect(inner.x, inner.y, inner.width, 2),
                wrap(&hint, inner.width as usize)
                    .into_iter()
                    .take(2)
                    .collect::<Vec<_>>()
                    .join("\n"),
                MUTED,
            );
            let body = rect(
                inner.x,
                inner.y + 3,
                inner.width,
                inner.height.saturating_sub(6),
            );
            let mut y = body.y;
            let start = if fields.len() > 3 {
                focus.saturating_sub(1)
            } else {
                0
            };
            for (i, field) in fields.iter().enumerate().skip(start) {
                let wanted = if field.multiline {
                    body.height.clamp(3, 11)
                } else {
                    3
                };
                if y + wanted > body.bottom() {
                    if i == focus && body.bottom().saturating_sub(y) >= 3 {
                    } else {
                        break;
                    }
                }
                let height = wanted.min(body.bottom().saturating_sub(y));
                if height < 3 {
                    break;
                }
                let row = rect(body.x, y, body.width, height);
                let block = Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(if i == focus { ACCENT } else { BORDER }))
                    .title(format!(
                        " {}{} ",
                        field.label,
                        if fields.len() > 1 {
                            format!("  {}/{}", i + 1, fields.len())
                        } else {
                            String::new()
                        }
                    ));
                let input = block.inner(row);
                f.render_widget(block, row);
                let width = input.width.saturating_sub(2) as usize;
                let mut display = field.edit.clone();
                if field.secret {
                    display.value.fill('*');
                }
                let (lines, cursor, _) = display.wrapped(width);
                let offset = cursor
                    .0
                    .saturating_sub(input.height.saturating_sub(1) as usize);
                label(
                    f,
                    rect(
                        input.x + 1,
                        input.y,
                        input.width.saturating_sub(1),
                        input.height,
                    ),
                    lines
                        .into_iter()
                        .skip(offset)
                        .collect::<Vec<_>>()
                        .join("\n"),
                    FG,
                );
                app.hits.push((row, Hit::Field(i, input, offset)));
                if i == focus {
                    f.set_cursor_position((
                        input.x + 1 + cursor.1.min(width) as u16,
                        input.y
                            + (cursor.0 - offset).min(input.height.saturating_sub(1) as usize)
                                as u16,
                    ));
                }
                y += height;
            }
            let by = inner.bottom() - 2;
            let mut x = inner.x;
            x = button(
                f,
                app,
                x,
                by,
                if kind == "review" {
                    "Save draft"
                } else if kind == "pair-phone" {
                    "Get code"
                } else if kind == "source-search" {
                    "Search"
                } else if kind == "source-scrape" {
                    "Scrape"
                } else if kind == "source-crawl" {
                    "Start crawl"
                } else if kind == "source-collect" {
                    "Collect contacts"
                } else if kind == "source-key" {
                    "Save key"
                } else if kind == "source-import" {
                    "Import"
                } else if kind == "write" {
                    "Send"
                } else {
                    "Save"
                },
                Action::new("form-save", Value::Null),
                kind != "review",
            );
            if kind == "review" {
                x = button(
                    f,
                    app,
                    x,
                    by,
                    "Review send",
                    Action::new("form-send", Value::Null),
                    true,
                );
            }
            button(
                f,
                app,
                x,
                by,
                "Cancel",
                Action::new("modal-close", Value::Null),
                false,
            );
            label(
                f,
                rect(inner.x, inner.bottom() - 1, inner.width, 1),
                "Tab next field · Ctrl+S / Ctrl+G save · Ctrl+U clear · Esc cancel",
                MUTED,
            );
        }
        Modal::Confirm { body, action, .. } => {
            f.render_widget(
                Paragraph::new(safe(&body))
                    .style(Style::default().fg(FG))
                    .wrap(Wrap { trim: false }),
                rect(inner.x, inner.y + 1, inner.width, inner.height - 5),
            );
            let x = button(
                f,
                app,
                inner.x,
                inner.bottom() - 2,
                "Cancel",
                Action::new("modal-close", Value::Null),
                false,
            );
            button(
                f,
                app,
                x,
                inner.bottom() - 2,
                if action.name == "request" && strv(&action.data, "path") == "/api/draft/review" {
                    "Queue message"
                } else {
                    "Confirm"
                },
                action,
                true,
            );
            label(
                f,
                rect(inner.x, inner.bottom() - 1, inner.width, 1),
                "Y confirm · Esc / Enter cancel · Click the explicit action",
                MUTED,
            );
        }
        Modal::Help => {
            let text = "01 Dashboard   Live analytics, activity and permanent operator chat\n02 WhatsApp    Pair your number and manage scoped conversations\n03 Contacts    Import, export, memory, meetings and next steps\n04 Settings    Model, prompts, safeguards and backups\n05 Sources     Firecrawl search, scrape and website crawls\n\nMouse: click navigation, rows, actions and fields; wheel to scroll.\nKeyboard: 1–5 pages · ↑↓ select · Enter actions · Space agent\nTab focus · / search · C chat · M meetings · H previous runs\nEditors: Ctrl+S or Ctrl+G save · Ctrl+U clear · Esc cancel\n\nModel integration: Codex CLI or your self-hosted endpoint.\nTerminal stack: Ratatui + Crossterm, also used by OpenAI Codex.\nThis is a dedicated outreach interface, not a coding session.";
            f.render_widget(
                Paragraph::new(text)
                    .style(Style::default().fg(FG))
                    .wrap(Wrap { trim: false }),
                inner,
            );
            button(
                f,
                app,
                inner.x,
                inner.bottom() - 1,
                "Close",
                Action::new("modal-close", Value::Null),
                false,
            );
        }
        Modal::Qr => {
            let wa = app.state["whatsapp"].clone();
            label(
                f,
                rect(inner.x, inner.y, inner.width, 2),
                if wa["relogin_required"].as_bool().unwrap_or(false) {
                    format!(
                        "Relink {} on WhatsApp → Linked devices → Link a device.\nYour contacts and memory are saved. Press Start Agent after linking.",
                        strv(&wa, "relogin_phone")
                    )
                } else {
                    "On your phone: WhatsApp → Linked devices → Link a device.\nThe scanned account becomes the verified sender.".into()
                },
                MUTED,
            );
            if strv(&wa, "status") == "connected" {
                label(
                    f,
                    rect(inner.x, inner.y + 5, inner.width, 2),
                    format!(
                        "Connected as {}\nNow enable only the contacts you want the agent to access.",
                        strv(&wa, "phone")
                    ),
                    ACCENT,
                );
            } else if strv(&wa, "pairing_mode") == "phone" {
                let code = strv(&wa, "pairing_code");
                let message = if !code.is_empty() {
                    let formatted = if code.len() == 8 {
                        format!("{}–{}", &code[..4], &code[4..])
                    } else {
                        code.to_owned()
                    };
                    format!(
                        "PAIRING CODE   {formatted}\n\nOn your phone: WhatsApp → Linked devices → Link a device\n→ Link with phone number instead. Enter this code there.\n\nNumber: {}\nThis number becomes the sender only after WhatsApp confirms linking.\nIf WhatsApp rejects the code, request another code or use QR.",
                        strv(&wa, "pairing_phone")
                    )
                } else if !strv(&wa, "error").is_empty() {
                    strv(&wa, "error").to_owned()
                } else {
                    "Requesting a pairing code…\nKeep WhatsApp open on your phone.".into()
                };
                f.render_widget(
                    Paragraph::new(message)
                        .style(Style::default().fg(if code.is_empty() { GOLD } else { ACCENT }))
                        .wrap(Wrap { trim: false }),
                    rect(
                        inner.x,
                        inner.y + 4,
                        inner.width,
                        inner.height.saturating_sub(7),
                    ),
                );
            } else if let Some(matrix) = wa.get("qr_matrix") {
                let size = num(matrix, "size") as usize;
                let data = list(matrix, "data");
                let border = 4;
                let width = size + border * 2;
                let height = width.div_ceil(2);
                if inner.width as usize >= width && inner.height as usize >= height + 5 {
                    let x = inner.x + (inner.width - width as u16) / 2;
                    let y = inner.y + 3;
                    let dark = |r: isize, c: isize| {
                        r >= 0
                            && c >= 0
                            && (r as usize) < size
                            && (c as usize) < size
                            && data
                                .get(r as usize * size + c as usize)
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                > 0
                    };
                    for row in (0..width).step_by(2) {
                        let text = (0..width)
                            .map(|col| {
                                let top = dark(
                                    row as isize - border as isize,
                                    col as isize - border as isize,
                                );
                                let bottom = dark(
                                    row as isize + 1 - border as isize,
                                    col as isize - border as isize,
                                );
                                match (top, bottom) {
                                    (true, true) => '█',
                                    (true, false) => '▀',
                                    (false, true) => '▄',
                                    _ => ' ',
                                }
                            })
                            .collect::<String>();
                        f.render_widget(
                            Paragraph::new(text)
                                .style(Style::default().fg(Color::Black).bg(Color::White)),
                            rect(x, y + (row / 2) as u16, width as u16, 1),
                        );
                    }
                } else {
                    label(
                        f,
                        rect(inner.x, inner.y + 5, inner.width, 3),
                        format!(
                            "Enlarge the terminal to at least {} × {} to scan this QR.\nReducing the terminal font size also helps.",
                            width + 8,
                            height + 10
                        ),
                        GOLD,
                    );
                }
            } else {
                label(
                    f,
                    rect(inner.x, inner.y + 5, inner.width, 3),
                    if strv(&wa, "error").is_empty() {
                        "Waiting for the pairing QR…"
                    } else {
                        strv(&wa, "error")
                    },
                    GOLD,
                );
            }
            if strv(&wa, "status") != "connected" {
                let x = button(
                    f,
                    app,
                    inner.x,
                    inner.bottom() - 2,
                    "Enter phone number instead",
                    Action::new("pair-phone", Value::Null),
                    false,
                );
                if x + 12 < inner.right() {
                    button(
                        f,
                        app,
                        x,
                        inner.bottom() - 2,
                        "Use QR",
                        Action::new("connect", Value::Null),
                        false,
                    );
                }
            }
            button(
                f,
                app,
                inner.x,
                inner.bottom() - 1,
                "Back",
                Action::new("modal-close", Value::Null),
                false,
            );
        }
    }
}
