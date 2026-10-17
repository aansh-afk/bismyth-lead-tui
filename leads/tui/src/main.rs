mod app;
mod editor;
mod ui;
use app::*;
use crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};
use serde_json::{Value, json};
use std::{
    io,
    time::{Duration, Instant},
};

fn main() {
    if let Err(error) = run() {
        eprintln!("bismyth-leads: {error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let base = std::env::var("ORACLE_LEADS_URL")
        .map_err(|_| "Start this interface with bismyth-leads.")?;
    let key = std::fs::read_to_string(std::env::var("ORACLE_LEADS_KEY_FILE")?)?;
    let api = Api::new(base, key.trim().into()).map_err(io::Error::other)?;
    let mut app =
        App::new(api, std::env::var("ORACLE_LEADS_PROVIDER").ok()).map_err(io::Error::other)?;
    let original_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = disable_raw_mode();
        let _ = execute!(
            io::stdout(),
            LeaveAlternateScreen,
            DisableMouseCapture,
            DisableBracketedPaste
        );
        original_hook(info);
    }));
    enable_raw_mode()?;
    execute!(
        io::stdout(),
        EnterAlternateScreen,
        EnableMouseCapture,
        EnableBracketedPaste
    )?;
    let mut terminal = Terminal::new(CrosstermBackend::new(io::stdout()))?;
    let result = event_loop(&mut terminal, &mut app);
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture,
        DisableBracketedPaste
    )?;
    terminal.show_cursor()?;
    result
}
fn hit_action(app: &mut App, action: Action) {
    match action.name.as_str() {
        "form-save" => app.submit_form(false),
        "form-send" => app.submit_form(true),
        "modal-close" => app.modal = None,
        _ => app.perform(action),
    }
}
fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut last_click: Option<(u16, u16, Instant)> = None;
    while !app.quit {
        app.drain();
        app.refresh();
        app.tick += 1;
        terminal.draw(|f| ui::draw(f, app))?;
        if !event::poll(Duration::from_millis(90))? {
            continue;
        }
        match event::read()? {
            Event::Key(key) if key.kind != KeyEventKind::Release => handle_key(app, key),
            Event::Paste(text) => {
                if let Some(Modal::Form { fields, focus, .. }) = &mut app.modal {
                    if let Some(field) = fields.get_mut(*focus) {
                        field.edit.insert(&text);
                    }
                } else if app.search_focus {
                    app.search_editor.insert(&text.replace(['\n', '\r'], " "));
                    app.update_search();
                } else if app.composer_focus {
                    app.composer.insert(&text);
                }
            }
            Event::Mouse(mouse) => {
                if mouse.kind == MouseEventKind::Down(MouseButton::Left) {
                    let clicked = app
                        .hits
                        .iter()
                        .filter(|(r, _)| r.contains((mouse.column, mouse.row).into()))
                        .max_by_key(|(_, h)| match h {
                            Hit::Action(_) | Hit::Menu(_) | Hit::Field(..) => 3,
                            Hit::Contact(_) => 2,
                            Hit::Composer(..) | Hit::Search(..) => 1,
                            _ => 0,
                        })
                        .cloned();
                    if let Some((_, hit)) = clicked {
                        match hit {
                            Hit::Action(action) => hit_action(app, action),
                            Hit::Contact(index) => {
                                let double = last_click
                                    .as_ref()
                                    .map(|(x, y, t)| {
                                        *x == mouse.column
                                            && *y == mouse.row
                                            && t.elapsed() < Duration::from_millis(450)
                                    })
                                    .unwrap_or(false);
                                app.search_focus = false;
                                app.select(index);
                                if double {
                                    app.open_contact_actions();
                                }
                            }
                            Hit::Menu(index) => {
                                let action = if let Some(Modal::Menu {
                                    items, selected, ..
                                }) = &mut app.modal
                                {
                                    *selected = index;
                                    items.get(index).map(|(_, a)| a.clone())
                                } else {
                                    None
                                };
                                if let Some(action) = action {
                                    app.perform(action);
                                }
                            }
                            Hit::Field(index, r, offset) => {
                                if let Some(Modal::Form { fields, focus, .. }) = &mut app.modal {
                                    *focus = index;
                                    if let Some(field) = fields.get_mut(index) {
                                        field.edit.click(
                                            mouse.row.saturating_sub(r.y) as usize,
                                            mouse.column.saturating_sub(r.x + 1) as usize,
                                            r.width.saturating_sub(2) as usize,
                                            offset,
                                        );
                                    }
                                }
                            }
                            Hit::Composer(r, offset) => {
                                app.composer_focus = true;
                                app.composer.click(
                                    mouse.row.saturating_sub(r.y) as usize,
                                    mouse.column.saturating_sub(r.x + 1) as usize,
                                    r.width.saturating_sub(10) as usize,
                                    offset,
                                );
                            }
                            Hit::Search(r, offset) => {
                                app.focus_search();
                                app.search_editor.click(
                                    0,
                                    mouse.column.saturating_sub(r.x + 1) as usize,
                                    r.width.saturating_sub(2) as usize,
                                    offset,
                                );
                            }
                            Hit::Transcript => {
                                app.composer_focus = false;
                                app.search_focus = false;
                            }
                            Hit::List => {}
                        }
                    }
                    last_click = Some((mouse.column, mouse.row, Instant::now()));
                } else if matches!(
                    mouse.kind,
                    MouseEventKind::ScrollUp | MouseEventKind::ScrollDown
                ) {
                    let up = mouse.kind == MouseEventKind::ScrollUp;
                    if let Some(Modal::Menu {
                        selected, items, ..
                    }) = &mut app.modal
                    {
                        if !items.is_empty() {
                            *selected = if up {
                                selected.saturating_sub(1)
                            } else {
                                (*selected + 1).min(items.len() - 1)
                            };
                        }
                    } else if app.modal.is_none() {
                        let list_hit = app.hits.iter().any(|(r, h)| {
                            matches!(h, Hit::List) && r.contains((mouse.column, mouse.row).into())
                        });
                        if list_hit && matches!(app.page, 1 | 2 | 4) {
                            let count = if app.page == 4 {
                                app.source_pages().len()
                            } else {
                                app.contacts().len()
                            };
                            if count > 0 {
                                app.select(if up {
                                    app.row.saturating_sub(1)
                                } else {
                                    (app.row + 1).min(count - 1)
                                });
                            }
                        } else if app.page == 3 {
                            app.settings_row = if up {
                                app.settings_row.saturating_sub(1)
                            } else {
                                (app.settings_row + 1).min(app.settings().len() - 1)
                            };
                        } else {
                            let scroll = if app.page == 0 {
                                &mut app.chat_scroll
                            } else {
                                &mut app.thread_scroll
                            };
                            let backwards = if app.page == 4
                                || (matches!(app.page, 1 | 2) && app.detail_tab != 1)
                            {
                                !up
                            } else {
                                up
                            };
                            *scroll = if backwards {
                                (*scroll + 3).min(10000)
                            } else {
                                scroll.saturating_sub(3)
                            };
                        }
                    }
                }
            }
            Event::Resize(_, _) => {}
            _ => {}
        }
    }
    Ok(())
}
fn handle_key(app: &mut App, key: KeyEvent) {
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        if app.modal.is_some() {
            app.modal = None;
        } else {
            app.quit = true;
        }
        return;
    }
    if let Some(dialog) = app.modal.clone() {
        match dialog {
            Modal::Menu {
                items, selected, ..
            } => match key.code {
                KeyCode::Esc => app.modal = None,
                KeyCode::Up | KeyCode::Char('k') => {
                    if let Some(Modal::Menu { selected, .. }) = &mut app.modal {
                        *selected = selected.saturating_sub(1);
                    }
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    if let Some(Modal::Menu { selected, .. }) = &mut app.modal {
                        *selected = (*selected + 1).min(items.len().saturating_sub(1));
                    }
                }
                KeyCode::Enter => {
                    if let Some((_, action)) = items.get(selected) {
                        app.perform(action.clone());
                    }
                }
                KeyCode::Char(c) if ('1'..='9').contains(&c) => {
                    if let Some((_, action)) = items.get(c as usize - '1' as usize) {
                        app.perform(action.clone());
                    }
                }
                _ => {}
            },
            Modal::Form { fields, focus, .. } => {
                if key.code == KeyCode::Esc {
                    app.modal = None;
                    return;
                }
                if key.modifiers.contains(KeyModifiers::CONTROL)
                    && matches!(key.code, KeyCode::Char('s') | KeyCode::Char('g'))
                {
                    app.submit_form(false);
                    return;
                }
                if key.code == KeyCode::Tab {
                    if let Some(Modal::Form { focus, .. }) = &mut app.modal {
                        *focus = (*focus + 1) % fields.len();
                    }
                    return;
                }
                if key.code == KeyCode::BackTab {
                    if let Some(Modal::Form { focus, .. }) = &mut app.modal {
                        *focus = (*focus + fields.len() - 1) % fields.len();
                    }
                    return;
                }
                if key.code == KeyCode::Enter && !fields[focus].multiline {
                    if focus + 1 < fields.len() {
                        if let Some(Modal::Form { focus, .. }) = &mut app.modal {
                            *focus += 1;
                        }
                    } else {
                        app.submit_form(false);
                    }
                    return;
                }
                if let Some(Modal::Form { fields, focus, .. }) = &mut app.modal {
                    let width = app
                        .hits
                        .iter()
                        .find_map(|(_, h)| {
                            if let Hit::Field(i, r, _) = h {
                                if *i == *focus {
                                    Some(r.width.saturating_sub(2) as usize)
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        })
                        .unwrap_or(70);
                    let field = &mut fields[*focus];
                    if matches!(key.code, KeyCode::Up | KeyCode::Down) {
                        field.edit.vertical(key.code == KeyCode::Up, width);
                    } else {
                        field.edit.key(key, field.multiline);
                    }
                }
            }
            Modal::Confirm { action, .. } => match key.code {
                KeyCode::Char('y') | KeyCode::Char('Y') => app.perform(action),
                KeyCode::Esc | KeyCode::Enter | KeyCode::Char('n') => app.modal = None,
                _ => {}
            },
            Modal::Qr | Modal::Help => {
                if matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
                    app.modal = None;
                }
            }
        }
        return;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL)
        && key.code == KeyCode::Char('f')
        && matches!(app.page, 1 | 2)
    {
        app.focus_search();
        return;
    }
    if app.search_focus {
        match key.code {
            KeyCode::Esc | KeyCode::Enter | KeyCode::Tab | KeyCode::Down => {
                app.search_focus = false
            }
            _ => {
                app.search_editor.key(key, false);
                app.update_search();
            }
        }
        return;
    }
    if app.composer_focus {
        match key.code {
            KeyCode::Esc | KeyCode::Tab => app.composer_focus = false,
            KeyCode::Enter if !key.modifiers.contains(KeyModifiers::SHIFT) => app.send_chat(),
            KeyCode::Up | KeyCode::Down => {
                let width = app
                    .hits
                    .iter()
                    .find_map(|(_, h)| {
                        if let Hit::Composer(r, _) = h {
                            Some(r.width.saturating_sub(10) as usize)
                        } else {
                            None
                        }
                    })
                    .unwrap_or(70);
                app.composer.vertical(key.code == KeyCode::Up, width);
            }
            _ => app.composer.key(key, true),
        }
        return;
    }
    match key.code {
        KeyCode::Char(c) if ('1'..='5').contains(&c) => app.page(c as usize - '1' as usize),
        KeyCode::Char('q') => app.quit = true,
        KeyCode::Char('?') => app.modal = Some(Modal::Help),
        KeyCode::Char(' ') => app.perform(Action::new("toggle-agent", Value::Null)),
        KeyCode::Char('r') => app.perform(Action::new("refresh", Value::Null)),
        KeyCode::Tab => {
            if app.page == 0 {
                app.composer_focus = true;
            } else if matches!(app.page, 1 | 2 | 4) {
                app.open_contact_actions();
            }
        }
        KeyCode::Up => {
            if app.page == 3 {
                app.settings_row = app.settings_row.saturating_sub(1);
            } else if matches!(app.page, 1 | 2 | 4) {
                app.select(app.row.saturating_sub(1));
            } else {
                app.chat_scroll += 2;
            }
        }
        KeyCode::Down => {
            if app.page == 3 {
                app.settings_row = (app.settings_row + 1).min(app.settings().len() - 1);
            } else if matches!(app.page, 1 | 2 | 4) {
                let count = if app.page == 4 {
                    app.source_pages().len()
                } else {
                    app.contacts().len()
                };
                if count > 0 {
                    app.select((app.row + 1).min(count - 1));
                }
            } else {
                app.chat_scroll = app.chat_scroll.saturating_sub(2);
            }
        }
        KeyCode::Enter => {
            if app.page == 3 {
                let key = app.settings()[app.settings_row].2;
                app.setting(key);
            } else if matches!(app.page, 1 | 2 | 4) {
                app.open_contact_actions();
            } else {
                app.composer_focus = true;
            }
        }
        KeyCode::PageUp if matches!(app.page, 1 | 2) => app.select(app.row.saturating_sub(10)),
        KeyCode::PageDown if matches!(app.page, 1 | 2) => {
            app.select((app.row + 10).min(app.contacts().len().saturating_sub(1)))
        }
        KeyCode::Home if matches!(app.page, 1 | 2) => app.select(0),
        KeyCode::End if matches!(app.page, 1 | 2) => {
            app.select(app.contacts().len().saturating_sub(1))
        }
        KeyCode::Char('/') => app.perform(Action::new("search", Value::Null)),
        KeyCode::Char('c') if app.page == 0 => app.composer_focus = true,
        KeyCode::Char('c') if app.page == 1 => app.perform(Action::new("connect", Value::Null)),
        KeyCode::Char('f') if app.page == 1 => app.perform(Action::new("pair-phone", Value::Null)),
        KeyCode::Char('m') => app.perform(Action::new("meetings", json!(false))),
        KeyCode::Char('h') => app.perform(Action::new("runs", Value::Null)),
        KeyCode::Char('i') if app.page == 2 => app.perform(Action::new("import", Value::Null)),
        KeyCode::Char('e') if app.page == 2 => app.perform(Action::new("export", Value::Null)),
        KeyCode::Char('l') if app.page == 2 => app.perform(Action::new("legacy", Value::Null)),
        KeyCode::Char('a') if matches!(app.page, 1 | 2) => {
            app.perform(Action::new("scope", Value::Null))
        }
        KeyCode::Char('g') if matches!(app.page, 1 | 2) => {
            app.perform(Action::new("generate", Value::Null))
        }
        KeyCode::Char('w') if matches!(app.page, 1 | 2) => {
            app.perform(Action::new("write", Value::Null))
        }
        KeyCode::Char('j') if matches!(app.page, 1 | 2) => {
            app.perform(Action::new("jobs", Value::Null))
        }
        KeyCode::Char('n') if matches!(app.page, 1 | 2) => {
            app.perform(Action::new("memory", Value::Null))
        }
        KeyCode::Char('p') if matches!(app.page, 1 | 2) => {
            app.perform(Action::new("takeover", Value::Null))
        }
        KeyCode::Char('s') if app.page == 4 => {
            app.perform(Action::new("source-search", Value::Null))
        }
        KeyCode::Char('i') if app.page == 4 => {
            app.perform(Action::new("source-contacts", Value::Null))
        }
        KeyCode::Char('v') if app.page == 3 => app.perform(Action::new("verify", Value::Null)),
        KeyCode::Char('b') if app.page == 3 => app.perform(Action::new("backup", Value::Null)),
        KeyCode::Char('o') if app.page == 3 => app.perform(Action::new("restore", Value::Null)),
        _ => {}
    }
}
