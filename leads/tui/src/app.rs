use crate::editor::Editor;
use ratatui::layout::Rect;
use serde_json::{Value, json};
use std::{
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

pub fn strv<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub fn num(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}
pub fn list(v: &Value, key: &str) -> Vec<Value> {
    v.get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}
pub fn clip(value: &str, len: usize) -> String {
    value.chars().take(len).collect()
}
pub fn contact_matches(c: &Value, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return true;
    }
    let identity = format!(
        "{} {} {} {} {} {}",
        strv(c, "name"),
        strv(c, "company"),
        strv(c, "role"),
        strv(c, "stage"),
        strv(c, "notes"),
        strv(c, "source")
    )
    .to_lowercase();
    let digits = query
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    let phone_only = query
        .chars()
        .all(|ch| ch.is_ascii_digit() || "+()- .".contains(ch));
    if phone_only && digits.len() >= 3 {
        return strv(c, "phone").contains(&digits) || identity.contains(&query);
    }
    query.split_whitespace().all(|term| identity.contains(term))
}
#[derive(Clone)]
pub struct Api {
    pub base: String,
    cookie: String,
    agent: ureq::Agent,
}
impl Api {
    pub fn new(base: String, key: String) -> Result<Self, String> {
        if !base.starts_with("http://127.0.0.1:") && !base.starts_with("http://localhost:") {
            return Err("Only the local outreach service is supported.".into());
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(3))
            .timeout_read(Duration::from_secs(200))
            .build();
        let r = agent
            .get(&format!("{base}/api/bootstrap"))
            .set("X-Oracle-Key", &key)
            .call()
            .map_err(|_| "Could not initialize the private local session.")?;
        let cookie = r
            .header("set-cookie")
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        Ok(Self {
            base,
            cookie,
            agent,
        })
    }
    pub fn get(&self, path: &str) -> Result<Value, String> {
        self.read(
            self.agent
                .get(&format!("{}{path}", self.base))
                .set("Cookie", &self.cookie)
                .timeout(Duration::from_secs(4))
                .call(),
        )
    }
    pub fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.read(
            self.agent
                .post(&format!("{}{path}", self.base))
                .set("Cookie", &self.cookie)
                .set("X-Oracle-Request", "1")
                .send_json(body),
        )
    }
    fn read(&self, result: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
        match result {
            Ok(r) => r
                .into_json()
                .map_err(|_| "Invalid service response.".into()),
            Err(ureq::Error::Status(_, r)) => {
                let data: Value = r.into_json().unwrap_or_default();
                Err(strv(&data, "error").to_owned())
            }
            Err(_) => Err("The local service is unavailable. Your memory is saved on disk.".into()),
        }
    }
    pub fn export_csv(&self) -> Result<String, String> {
        self.agent
            .get(&format!("{}/api/export.csv", self.base))
            .set("Cookie", &self.cookie)
            .call()
            .map_err(|_| "Export failed.")?
            .into_string()
            .map_err(|_| "Export could not be read.".into())
    }
}
#[derive(Clone)]
pub struct Action {
    pub name: String,
    pub data: Value,
}
impl Action {
    pub fn new(name: &str, data: Value) -> Self {
        Self {
            name: name.into(),
            data,
        }
    }
}
#[derive(Clone)]
pub struct Field {
    pub label: String,
    pub edit: Editor,
    pub multiline: bool,
    pub secret: bool,
}
impl Field {
    pub fn new(label: &str, value: &str, multiline: bool) -> Self {
        Self {
            label: label.into(),
            edit: Editor::new(value),
            multiline,
            secret: false,
        }
    }
    pub fn secret(label: &str) -> Self {
        let mut field = Self::new(label, "", false);
        field.secret = true;
        field
    }
}
#[derive(Clone)]
pub enum Modal {
    Menu {
        title: String,
        hint: String,
        items: Vec<(String, Action)>,
        selected: usize,
    },
    Form {
        title: String,
        hint: String,
        kind: String,
        data: Value,
        fields: Vec<Field>,
        focus: usize,
    },
    Confirm {
        title: String,
        body: String,
        action: Action,
    },
    Qr,
    Help,
}
#[derive(Clone)]
pub enum Hit {
    Action(Action),
    Contact(usize),
    Field(usize, Rect, usize),
    Menu(usize),
    Composer(Rect, usize),
    Search(Rect, usize),
    Transcript,
    List,
}
pub struct Completion {
    pub result: Result<Value, String>,
    pub notice: String,
    pub next: String,
}
pub struct App {
    pub api: Api,
    pub state: Value,
    pub detail: Value,
    pub page: usize,
    pub row: usize,
    pub selected_id: String,
    pub notice: String,
    pub modal: Option<Modal>,
    pub hits: Vec<(Rect, Hit)>,
    pub busy: bool,
    pub composer: Editor,
    pub composer_focus: bool,
    pub chat_scroll: usize,
    pub thread_scroll: usize,
    pub search: String,
    pub search_editor: Editor,
    pub search_focus: bool,
    pub contact_filter: String,
    pub detail_tab: usize,
    pub settings_row: usize,
    pub quit: bool,
    pub last_refresh: Instant,
    pub tick: u64,
    pub relogin_seen: String,
    pub rx: Receiver<Completion>,
    pub tx: Sender<Completion>,
}
impl App {
    pub fn new(api: Api, provider: Option<String>) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel();
        let state = api.get("/api/state")?;
        let mut app = Self {
            api,
            state,
            detail: Value::Null,
            page: 0,
            row: 0,
            selected_id: String::new(),
            notice: "Your relationship memory is local. Outreach starts paused.".into(),
            modal: None,
            hits: vec![],
            busy: false,
            composer: Editor::default(),
            composer_focus: false,
            chat_scroll: 0,
            thread_scroll: 0,
            search: String::new(),
            search_editor: Editor::default(),
            search_focus: false,
            contact_filter: "all".into(),
            detail_tab: 0,
            settings_row: 0,
            quit: false,
            last_refresh: Instant::now(),
            tick: 0,
            relogin_seen: String::new(),
            rx,
            tx,
        };
        if let Some(p) = provider {
            app.api.post(
                "/api/settings",
                json!({"provider":p,"automation_paused":true}),
            )?;
        } else {
            app.provider_menu();
        }
        Ok(app)
    }
    pub fn provider_menu(&mut self) {
        self.menu(
            "Choose your model",
            "One workspace. The same permanent memory with either provider.",
            vec![
                (
                    "Codex subscription  ·  existing ChatGPT sign-in",
                    Action::new("set-provider", json!("codex")),
                ),
                (
                    "Self-hosted model  ·  configured Oracle endpoint",
                    Action::new("set-provider", json!("selfhost")),
                ),
            ],
        );
    }
    pub fn menu(&mut self, title: &str, hint: &str, items: Vec<(&str, Action)>) {
        self.modal = Some(Modal::Menu {
            title: title.into(),
            hint: hint.into(),
            items: items.into_iter().map(|(s, a)| (s.into(), a)).collect(),
            selected: 0,
        });
    }
    pub fn owned_menu(&mut self, title: &str, hint: &str, items: Vec<(String, Action)>) {
        self.modal = Some(Modal::Menu {
            title: title.into(),
            hint: hint.into(),
            items,
            selected: 0,
        });
    }
    pub fn form(&mut self, title: &str, hint: &str, kind: &str, data: Value, fields: Vec<Field>) {
        self.modal = Some(Modal::Form {
            title: title.into(),
            hint: hint.into(),
            kind: kind.into(),
            data,
            fields,
            focus: 0,
        });
    }
    pub fn confirm(&mut self, title: &str, body: String, action: Action) {
        self.modal = Some(Modal::Confirm {
            title: title.into(),
            body,
            action,
        });
    }
    pub fn request(&mut self, path: &str, body: Value, notice: &str, next: &str) {
        if self.busy {
            self.notice = "Finish the current operation first. You can keep browsing.".into();
            return;
        }
        self.busy = true;
        let (api, tx, path, notice, next) = (
            self.api.clone(),
            self.tx.clone(),
            path.to_owned(),
            notice.to_owned(),
            next.to_owned(),
        );
        thread::spawn(move || {
            let result = if path == "/api/provider" {
                api.get(&path)
            } else {
                api.post(&path, body)
            };
            let _ = tx.send(Completion {
                result,
                notice,
                next,
            });
        });
    }
    pub fn refresh(&mut self) {
        if self.last_refresh.elapsed() < Duration::from_millis(1100) {
            return;
        }
        match self.api.get("/api/state") {
            Ok(v) => {
                self.state = v;
                let rows = if self.page == 4 {
                    self.source_pages()
                } else {
                    self.contacts()
                };
                if let Some(index) = rows.iter().position(|c| strv(c, "id") == self.selected_id) {
                    self.row = index;
                }
            }
            Err(e) => self.notice = e,
        };
        self.last_refresh = Instant::now();
        self.refresh_detail();
        self.prompt_relogin();
    }
    fn prompt_relogin(&mut self) {
        let wa = &self.state["whatsapp"];
        let id = strv(wa, "relogin_id").to_owned();
        if wa["relogin_required"].as_bool().unwrap_or(false)
            && !id.is_empty()
            && id != self.relogin_seen
            && self.modal.is_none()
            && !self.busy
        {
            self.relogin_seen = id;
            self.relogin_menu();
        }
    }
    pub fn relogin_menu(&mut self) {
        let phone = strv(&self.state["whatsapp"], "relogin_phone");
        let hint = format!(
            "Session expired. Relink {phone}. Memory is saved. After linking, press Start Agent."
        );
        self.menu(
            "Relink your WhatsApp number",
            &hint,
            vec![
                (
                    "Get a pairing code for the same number",
                    Action::new("relogin-phone", Value::Null),
                ),
                (
                    "Scan QR with the same number",
                    Action::new("relogin-qr", Value::Null),
                ),
                ("Later", Action::new("modal-close", Value::Null)),
            ],
        );
    }
    pub fn refresh_detail(&mut self) {
        if self.page == 4 {
            let rows = self.source_pages();
            if rows.is_empty() {
                self.detail = Value::Null;
                self.selected_id.clear();
                return;
            }
            self.row = self.row.min(rows.len() - 1);
            let id = strv(&rows[self.row], "id");
            self.selected_id = id.into();
            match self.api.get(&format!("/api/source/{id}")) {
                Ok(v) => self.detail = v,
                Err(e) => self.notice = e,
            };
            return;
        }
        let rows = self.contacts();
        if !rows.is_empty() {
            self.row = self.row.min(rows.len() - 1);
            let id = strv(&rows[self.row], "id");
            if self.selected_id != id {
                self.detail = Value::Null;
            }
            self.selected_id = id.into();
            match self.api.get(&format!("/api/contact/{id}")) {
                Ok(v) => self.detail = v,
                Err(error) => self.notice = error,
            }
        } else {
            self.detail = Value::Null;
            self.selected_id.clear();
        }
    }
    pub fn contacts(&self) -> Vec<Value> {
        let mut rows: Vec<Value> = list(&self.state, "contacts")
            .into_iter()
            .filter(|c| {
                let scoped = self.page != 1
                    || (num(c, "active") == 1
                        && strv(c, "sender") == strv(&self.state["whatsapp"], "phone"));
                let source = match self.contact_filter.as_str() {
                    "enabled" => num(c, "active") == 1,
                    "whatsapp" => c["whatsapp_known"].as_bool().unwrap_or(false),
                    "saved" => strv(c, "source") != "WhatsApp contacts",
                    _ => true,
                };
                scoped && source && contact_matches(c, &self.search)
            })
            .collect();
        rows.sort_by_cached_key(|c| (strv(c, "name").to_lowercase(), strv(c, "phone").to_owned()));
        rows
    }
    pub fn source_pages(&self) -> Vec<Value> {
        list(&self.state["sources"], "pages")
    }
    pub fn source_actions(&mut self) {
        if self.detail.is_null() {
            self.notice = "Search the web or add a website to start collecting sources.".into();
            return;
        }
        let title = format!("{} · source", clip(strv(&self.detail, "title"), 55));
        self.menu(
            &title,
            "Research is saved locally. Importing a contact leaves outreach inactive.",
            vec![
                (
                    "Inspect / refresh this page",
                    Action::new("source-scrape-selected", Value::Null),
                ),
                (
                    "Crawl this website",
                    Action::new("source-crawl-selected", Value::Null),
                ),
                (
                    "View this page’s contacts",
                    Action::new("source-contacts", Value::Null),
                ),
                (
                    "Import all phones from this page",
                    Action::new("source-import-all", json!({"page_ids":[self.detail["id"]]})),
                ),
                (
                    "Delete this source",
                    Action::new("source-delete", json!({"page_ids":[self.detail["id"]]})),
                ),
            ],
        );
    }
    pub fn source_contacts_menu(&mut self, all: bool, company: &str) {
        let page_id = strv(&self.detail, "id");
        let rows: Vec<Value> = list(&self.state["sources"], "contacts")
            .into_iter()
            .filter(|c| {
                (all || list(c, "sources")
                    .iter()
                    .any(|s| strv(s, "page_id") == page_id))
                    && (company.is_empty() || strv(c, "company_key") == company)
            })
            .collect();
        if rows.is_empty() {
            self.notice =
                "No contacts found yet. Collect saved results or crawl a company website.".into();
            return;
        }
        self.owned_menu("Sourced contacts", "Name · company · phone or email. Select a record for its role, affiliation and sources. First 1,000 records; export includes all.", rows.into_iter().map(|c| (format!("{} · {} · {}",if strv(&c,"name").is_empty(){"Name not stated"}else{strv(&c,"name")},if strv(&c,"company").is_empty(){"Company not stated"}else{strv(&c,"company")},if strv(&c,"phone").is_empty(){strv(&c,"email")}else{strv(&c,"phone")}),Action::new("source-contact-detail",c))).collect());
    }
    pub fn contact(&self) -> Value {
        self.detail["contact"].clone()
    }
    pub fn page(&mut self, index: usize) {
        self.page = index;
        self.row = 0;
        self.search.clear();
        self.search_editor = Editor::default();
        self.search_focus = false;
        self.contact_filter = "all".into();
        self.detail_tab = if index == 1 { 1 } else { 0 };
        self.composer_focus = false;
        self.thread_scroll = 0;
        self.refresh_detail();
    }
    pub fn update_search(&mut self) {
        self.search = self.search_editor.text();
        self.row = 0;
        self.thread_scroll = 0;
        let rows = self.contacts();
        let next = rows.first().map(|c| strv(c, "id")).unwrap_or("");
        if next != self.selected_id {
            self.refresh_detail();
        }
    }
    pub fn focus_search(&mut self) {
        if matches!(self.page, 1 | 2) {
            self.search_focus = true;
            self.composer_focus = false;
        }
    }
    pub fn select(&mut self, index: usize) {
        self.row = index;
        self.thread_scroll = 0;
        self.refresh_detail();
    }
    pub fn drain(&mut self) {
        while let Ok(done) = self.rx.try_recv() {
            self.busy = false;
            match done.result {
                Ok(value) => {
                    self.notice = if done.next == "source-result" {
                        if !strv(&value, "import_error").is_empty() {
                            strv(&value, "import_error").into()
                        } else {
                            let imported = &value["imported"];
                            format!(
                                "Source saved · added {} · existing {} · no phone {} · site contacts skipped {} · invalid {}",
                                num(imported, "added"),
                                num(imported, "duplicates"),
                                num(imported, "without_phone"),
                                num(imported, "site_contacts"),
                                list(imported, "errors").len()
                            )
                        }
                    } else if done.next == "import" {
                        format!(
                            "Imported {} contacts · {} duplicates · {} invalid. New contacts are inactive.",
                            num(&value, "added"),
                            num(&value, "duplicates"),
                            list(&value, "errors").len()
                        )
                    } else if value["email_only"].is_number() {
                        format!(
                            "Imported {} · existing {} · no phone {} · site contacts skipped {} · invalid {}",
                            num(&value, "added"),
                            num(&value, "duplicates"),
                            num(&value, "without_phone"),
                            num(&value, "site_contacts"),
                            list(&value, "errors").len()
                        )
                    } else if value["updated"].is_number() && value["unsupported"].is_number() {
                        format!(
                            "Reprocessed {} pages locally · {} unsupported layouts unchanged · {} research contacts",
                            num(&value, "updated"),
                            num(&value, "unsupported"),
                            num(&value, "contacts")
                        )
                    } else if done.next == "provider" {
                        strv(&value, "detail").into()
                    } else {
                        done.notice
                    };
                    self.last_refresh = Instant::now() - Duration::from_secs(2);
                    self.refresh();
                    if done.next == "source-result"
                        && self.page == 4
                        && let Some(index) = self
                            .source_pages()
                            .iter()
                            .position(|p| p["id"] == value["page_id"])
                    {
                        self.select(index);
                    }
                    if done.next == "draft-created" {
                        self.review_jobs();
                    }
                }
                Err(error) => self.notice = error,
            }
        }
    }
    pub fn send_chat(&mut self) {
        let text = self.composer.text();
        if text.trim().is_empty() {
            return;
        }
        if self.busy {
            self.notice = "Oracle is already working. Your draft stays in the composer.".into();
            return;
        }
        self.request(
            "/api/chat",
            json!({"message":text}),
            "Oracle answered from your relationship memory.",
            "",
        );
        self.composer = Editor::default();
        self.chat_scroll = 0;
    }
    pub fn open_contact_actions(&mut self) {
        if self.page == 4 {
            self.source_actions();
            return;
        }
        let c = self.contact();
        if c.is_null() {
            return;
        }
        let name = strv(&c, "name");
        self.menu(
            &format!("{name} · relationship actions"),
            "Only explicitly permitted contacts can be monitored or messaged.",
            vec![
                (
                    "Open conversation",
                    Action::new("conversation", Value::Null),
                ),
                (
                    if num(&c, "active") == 1 {
                        "Pause this contact"
                    } else {
                        "Enable WhatsApp scope"
                    },
                    Action::new("scope", Value::Null),
                ),
                ("Write a message", Action::new("write", Value::Null)),
                ("View automatic activity", Action::new("jobs", Value::Null)),
                (
                    "Edit relationship details",
                    Action::new("edit-contact", Value::Null),
                ),
                (
                    "Change relationship stage",
                    Action::new("stage", Value::Null),
                ),
                ("Add a permanent memory", Action::new("memory", Value::Null)),
                (
                    "Inspect and correct memories",
                    Action::new("memories", Value::Null),
                ),
                (
                    "Create a local meeting",
                    Action::new("new-meeting", Value::Null),
                ),
                ("Meeting records", Action::new("meetings", json!(true))),
                (
                    if num(&c, "auto_reply") == 1 {
                        "Take over replies manually"
                    } else {
                        "Return replies to agent"
                    },
                    Action::new("takeover", Value::Null),
                ),
                ("Record an opt-out", Action::new("optout", Value::Null)),
                (
                    "Delete relationship",
                    Action::new("delete-contact", Value::Null),
                ),
            ],
        );
    }
    pub fn review_jobs(&mut self) {
        self.refresh_detail();
        let jobs = list(&self.detail, "jobs")
            .into_iter()
            .filter(|j| {
                num(j, "automatic") == 1
                    || matches!(
                        strv(j, "status"),
                        "sent" | "sending" | "uncertain" | "completed"
                    )
            })
            .collect::<Vec<_>>();
        if jobs.is_empty() {
            self.notice =
                "No automatic activity yet. Start the agent to assess enabled relationships."
                    .into();
            return;
        }
        let items = jobs
            .into_iter()
            .map(|j| {
                (
                    format!(
                        "{}  {}",
                        match strv(&j, "status") {
                            "queued" => "WAITING".to_owned(),
                            "generating" => "WRITING".to_owned(),
                            "completed" => "NO REPLY NEEDED".to_owned(),
                            state => state.to_uppercase(),
                        },
                        clip(strv(&j, "text"), 65)
                    ),
                    Action::new("job", j),
                )
            })
            .collect();
        self.owned_menu("Automatic activity","Introductions and replies run automatically. Select an action to see its outcome and timing.",items);
    }
    pub fn meetings(&mut self, contact_only: bool) {
        let rows = list(&self.state, "meetings")
            .into_iter()
            .filter(|m| !contact_only || strv(m, "contact_id") == self.selected_id)
            .collect::<Vec<_>>();
        if rows.is_empty() {
            self.notice = "No meeting records. Select a contact to create a local meeting.".into();
            return;
        }
        let items = rows
            .into_iter()
            .map(|m| {
                (
                    format!(
                        "{}  {}  [{}]",
                        clip(strv(&m, "starts_at"), 16),
                        strv(&m, "name"),
                        strv(&m, "status")
                    ),
                    Action::new("meeting", m),
                )
            })
            .collect();
        self.owned_menu(
            "Meeting records",
            "Local CRM records. No external calendar invitation is implied.",
            items,
        );
    }
    pub fn settings(&self) -> Vec<(&'static str, String, &'static str)> {
        let s = &self.state["settings"];
        vec![
            ("Model provider", strv(s, "provider").into(), "provider"),
            (
                "Decision engine",
                format!(
                    "{} · {}",
                    strv(s, "decision_provider"),
                    strv(&self.state["decisions"], "phase")
                ),
                "decision_provider",
            ),
            (
                "Sales instructions",
                clip(strv(s, "system_prompt"), 70),
                "system_prompt",
            ),
            (
                "Atlas knowledge",
                clip(strv(s, "knowledge"), 70),
                "knowledge",
            ),
            (
                "Response timing",
                if num(s, "reply_delay_max") == 0 {
                    "Immediate".into()
                } else {
                    format!(
                        "{}–{} seconds",
                        num(s, "reply_delay_min"),
                        num(s, "reply_delay_max")
                    )
                },
                "delay",
            ),
            (
                "Daily send limit",
                num(s, "daily_limit").to_string(),
                "daily_limit",
            ),
            (
                "Quiet hours",
                format!(
                    "{:02}:00 — {:02}:00",
                    num(s, "quiet_start"),
                    num(s, "quiet_end")
                ),
                "quiet",
            ),
            (
                "Meeting booking link",
                strv(s, "meeting_link").into(),
                "meeting_link",
            ),
            (
                "Successful meeting link",
                strv(s, "success_link").into(),
                "success_link",
            ),
            (
                "Unsuccessful meeting link",
                strv(s, "unsuccessful_link").into(),
                "unsuccessful_link",
            ),
            ("Model override", strv(s, "model").into(), "model"),
        ]
    }
    pub fn setting(&mut self, key: &str) {
        match key {
            "provider" => self.provider_menu(),
            "decision_provider" => self.menu("Decision engine", strv(&self.state["decisions"],"detail").to_owned().as_str(), vec![
                ("Local Laya + automatic writer fallback", Action::new("settings-save", json!({"decision_provider":"laya"}))),
                ("Writer handles decisions", Action::new("settings-save", json!({"decision_provider":"writer"}))),
            ]),
            "delay" => self.form(
                "Response timing",
                "Seconds before composing and between automatic sends. Set both to 0 for immediate action.",
                "delay", Value::Null,
                vec![Field::new("Minimum seconds",&num(&self.state["settings"],"reply_delay_min").to_string(),false),Field::new("Maximum seconds",&num(&self.state["settings"],"reply_delay_max").to_string(),false)],
            ),
            "quiet" => self.form(
                "Quiet hours",
                "Local time, 0–23. Equal start/end disables quiet hours.",
                "quiet",
                Value::Null,
                vec![
                    Field::new(
                        "Start hour",
                        &num(&self.state["settings"], "quiet_start").to_string(),
                        false,
                    ),
                    Field::new(
                        "End hour",
                        &num(&self.state["settings"], "quiet_end").to_string(),
                        false,
                    ),
                ],
            ),
            _ => {
                let title = self
                    .settings()
                    .into_iter()
                    .find(|(_, _, k)| *k == key)
                    .map(|x| x.0)
                    .unwrap_or("Setting");
                let current = if key == "daily_limit" {
                    num(&self.state["settings"], key).to_string()
                } else {
                    strv(&self.state["settings"], key).into()
                };
                self.form(title,"Scope, sender binding and opt-outs remain enforced independently of editable instructions.","setting",json!(key),vec![Field::new(title,&current,matches!(key,"system_prompt"|"knowledge"))]);
            }
        }
    }
    pub fn perform(&mut self, action: Action) {
        let c = self.contact();
        let cid = strv(&c, "id").to_owned();
        self.modal = None;
        match action.name.as_str(){
            "page"=>self.page(action.data.as_u64().unwrap_or(0)as usize),
            "provider"=>self.provider_menu(),
            "set-provider"=>self.request("/api/settings",json!({"provider":action.data,"automation_paused":true}),"Provider selected. Outreach is paused.","provider-chosen"),
            "toggle-agent"=>{let paused=self.state["settings"]["automation_paused"].as_bool().unwrap_or(true);self.request(if paused {"/api/agent/start"} else {"/api/agent/pause"},json!({}),if paused {"Autonomous outreach started. Enabled relationships are assessed automatically."} else {"Agent paused."},"");},
            "verify"=>self.request("/api/provider",json!({}),"Provider check complete.","provider"),
            "settings-save"=>self.request("/api/settings",action.data,"Settings saved.",""),
            "setting"=>self.setting(action.data.as_str().unwrap_or("")),
            "refresh"=>{self.last_refresh=Instant::now()-Duration::from_secs(2);self.refresh();},
            "composer"=>{self.composer_focus=true;self.page=0;},
            "send-chat"=>self.send_chat(),
            "contact-actions"=>self.open_contact_actions(),
            "conversation"=>{if num(&c,"active")!=1{self.notice="Enable this relationship’s WhatsApp scope to open the scoped inbox.".into();}else{self.page(1);if let Some(index)=self.contacts().iter().position(|row|strv(row,"id")==cid){self.select(index);}}},
            "scope"=>{if num(&c,"active")==1{self.request("/api/contact/update",json!({"id":cid,"patch":{"active":false}}),"Contact paused.","");}else{self.confirm("Enable this contact’s WhatsApp scope?",format!("{}\n{}\n\nConfirm this person gave permission for WhatsApp outreach. Only this number will be enabled for the currently paired sender. Importing a number alone does not grant permission.",strv(&c,"name"),strv(&c,"phone")),Action::new("request",json!({"path":"/api/contact/update","body":{"id":cid,"patch":{"active":true,"consent":true}},"notice":"Contact enabled for the paired account."})));}},
            "takeover"=>self.request("/api/contact/update",json!({"id":cid,"patch":{"auto_reply":num(&c,"auto_reply")!=1}}),"Reply responsibility updated.",""),
            "generate"=>{self.notice="Start the agent to assess every enabled relationship and send automatically.".into();},
            "write"=>self.form("Write a message",&format!("To {} · {}. Send uses this exact text when the agent is running; sending limits still apply.",strv(&c,"name"),strv(&c,"phone")),"write",json!(cid),vec![Field::new("Message","",true)]),
            "jobs"=>self.review_jobs(),
            "job"=>{let j=action.data;if num(&j,"automatic")==1 && strv(&j,"status")!="uncertain" {self.owned_menu("Automatic action",&format!("{} · {}\n{}\n{}",strv(&j,"kind"),strv(&j,"status"),strv(&j,"text"),strv(&j,"error")),vec![(format!("Timing: {}",strv(&j,"due_at")),Action::new("noop",Value::Null)),(format!("Generation retries: {}",num(&j,"attempts")),Action::new("noop",Value::Null))]);return;}match strv(&j,"status"){
                "draft"|"failed"=>self.form("Review exact message",&format!("To {} · Sender {}. Saving does not send.",strv(&c,"phone"),strv(&self.state["whatsapp"],"phone")),"review",j.clone(),vec![Field::new("Message",strv(&j,"text"),true)]),
                "uncertain"=>{let jobid=strv(&j,"id");self.menu("Resolve uncertain send","Check the actual conversation in WhatsApp first. These actions never resend.",vec![("Verified sent on WhatsApp",Action::new("request",json!({"path":"/api/draft/resolve","body":{"id":jobid,"status":"sent"},"notice":"Send manually resolved as sent."}))),("Cancel after checking WhatsApp",Action::new("request",json!({"path":"/api/draft/resolve","body":{"id":jobid,"status":"cancelled"},"notice":"Uncertain operation cancelled without retry."})))]);},
                "queued"|"ready"=>self.confirm("Cancel queued operation?",strv(&j,"text").into(),Action::new("request",json!({"path":"/api/draft/cancel","body":{"id":j["id"]},"notice":"Queued operation cancelled."}))),
                _=>self.notice="This operation is still in progress.".into()
            }},
            "review-send"=>{let body=action.data;self.confirm("Send this reviewed message?",format!("SENDER  {}\nTO      {}\n\n{}\n\nThe agent must be running. Quiet hours and the daily cap still apply.",strv(&self.state["whatsapp"],"phone"),strv(&c,"phone"),strv(&body,"text")),Action::new("request",json!({"path":"/api/draft/review","body":{"id":body["id"],"text":body["text"],"send":true},"notice":"Exact message approved and queued."})));},
            "memory"=>self.form("Add relationship memory","Write a fact or correction you want retained across runs and providers.","memory",json!(cid),vec![Field::new("Memory","",true)]),
            "memories"=>{let memories=list(&self.detail,"memories");if memories.is_empty(){self.notice="No relationship memories yet. Add one from this contact’s actions.".into();}else{self.owned_menu("Relationship memory","Original messages are retained. Operator corrections take priority over model summaries.",memories.into_iter().map(|m|(format!("{}  {}",strv(&m,"kind"),clip(strv(&m,"content"),65)),Action::new("memory-edit",m))).collect());}},
            "memory-edit"=>{let memory=action.data;let source=list(&self.detail,"messages").into_iter().find(|m|m["id"]==memory["source_id"]).map(|m|clip(strv(&m,"text"),100)).unwrap_or("Operator-authored fact".into());self.form("Inspect or correct memory",&format!("Source: {source}. Clear the field to delete this memory."),"memory-edit",memory.clone(),vec![Field::new("Memory",strv(&memory,"content"),true)]);},
            "edit-contact"=>{let fields=[("Name","name"),("Company","company"),("Role","role"),("Source","source"),("Notes","notes"),("Next action","next_action"),("Follow-up · ISO date/time","followup_at")].into_iter().map(|(label,key)|Field::new(label,strv(&c,key),false)).collect();self.form("Edit relationship","Unknown facts should stay unknown. Changes invalidate old send approvals.","contact",json!(cid),fields);},
            "stage"=>{let stages=["new","contacted","replied","interested","meeting_requested","meeting_booked","pilot","client","not_interested","nurture","low_intent"];self.owned_menu("Relationship stage","Meeting requested, booked and completed are different outcomes.",stages.into_iter().map(|stage|(stage.replace('_'," "),Action::new("request",json!({"path":"/api/contact/update","body":{"id":cid,"patch":{"stage":stage}},"notice":"Relationship stage updated."})))).collect());},
            "optout"=>self.confirm("Record an opt-out?",format!("Stop outreach to {}. This disables scope and cancels queued work.",strv(&c,"name")),Action::new("request",json!({"path":"/api/contact/update","body":{"id":cid,"patch":{"opted_out":true}},"notice":"Opt-out recorded. Outreach stopped."}))),
            "delete-contact"=>self.confirm("Delete this relationship?",format!("Delete {} and their local messages, memories, meetings and jobs. Existing backup snapshots may retain older copies.",strv(&c,"name")),Action::new("request",json!({"path":"/api/contact/delete","body":{"id":cid},"notice":"Relationship deleted."}))),
            "new-meeting"=>self.form("Create a local meeting","Include a timezone in the ISO date, e.g. 2030-01-01T10:00:00+05:30. No calendar invitation is sent.","meeting",json!(cid),vec![Field::new("Title","Atlas walkthrough",false),Field::new("Date and time · ISO format","",false)]),
            "meetings"=>self.meetings(action.data.as_bool().unwrap_or(false)),
            "meeting"=>{let m=action.data;let mut items=vec![];for status in ["booked","successful","unsuccessful","cancelled"]{items.push((format!("Mark {status}"),Action::new("request",json!({"path":"/api/meeting/update","body":{"id":m["id"],"status":status},"notice":"Meeting outcome saved."}))));}items.push(("Delete meeting record".into(),Action::new("meeting-delete",m)));self.owned_menu("Meeting outcome","Configured outcome links are prepared only while the contact remains in scope.",items);},
            "meeting-delete"=>self.confirm("Delete meeting record?",strv(&action.data,"title").into(),Action::new("request",json!({"path":"/api/meeting/delete","body":{"id":action.data["id"]},"notice":"Meeting record deleted."}))),
            "pair-phone"=>{if self.state["whatsapp"]["relogin_required"].as_bool().unwrap_or(false){self.relogin_menu();}else{self.form("Link with phone number instead","Enter your WhatsApp number including country code. You will enter the displayed pairing code on your phone.","pair-phone",Value::Null,vec![Field::new("WhatsApp number · +country code",strv(&self.state["whatsapp"],"pairing_phone"),false)]);}},
            "relogin"=>self.relogin_menu(),
            "relogin-phone"|"relogin-qr"=>{self.modal=Some(Modal::Qr);self.request("/api/whatsapp/relogin",json!({"method":if action.name=="relogin-phone"{"phone"}else{"qr"}}),"Relink the previous number. Press Start Agent after linking.","");},
            "connect"=>{self.modal=Some(Modal::Qr);self.request("/api/whatsapp/connect",json!({}),"WhatsApp connection requested.","");},
            "disconnect"=>self.request("/api/whatsapp/disconnect",json!({}),"WhatsApp disconnected. Agent paused.",""),
            "unlink"=>self.confirm("Unlink WhatsApp?","Remove the local pairing and deactivate all contacts. You can also remove Oracle Leads from Linked devices on your phone.".into(),Action::new("request",json!({"path":"/api/whatsapp/unlink","body":{},"notice":"WhatsApp unlinked."}))),
            "import"=>self.form("Import contacts","CSV: name,phone,company,role,source,notes,stage. Saved stages are preserved; imports remain inactive. Numbers need +country code. JSON arrays also work.","import",Value::Null,vec![Field::new("Local file path","",false)]),
            "legacy"=>self.confirm("Import Bismyth saved contacts?","Read contacts from your older Bismyth Leads runs. Originals stay unchanged. All imported contacts start inactive.".into(),Action::new("request",json!({"path":"/api/import-legacy","body":{},"notice":"Older contacts imported.","next":"import"}))),
            "search"=>self.focus_search(),
            "refresh-contacts"=>self.request("/api/contacts/refresh",json!({}),"Available WhatsApp contact updates checked. Import a CSV for missing contacts.",""),
            "clear-search"=>{self.search_editor=Editor::default();self.contact_filter="all".into();self.update_search();},
            "filter"=>{self.contact_filter=action.data.as_str().unwrap_or("all").into();self.row=0;self.refresh_detail();},
            "detail-tab"=>{self.search_focus=false;self.detail_tab=action.data.as_u64().unwrap_or(0)as usize;self.thread_scroll=0;},
            "export"|"backup"=>{let backup=action.name=="backup";let home=std::env::var("HOME").unwrap_or(".".into());self.form(if backup{"Export relationship backup"}else{"Export contacts"},"Saved privately on this computer. Backups exclude WhatsApp credentials.","export",json!(backup),vec![Field::new("Save path",&format!("{home}/{}",if backup{"oracle-leads-backup.json"}else{"bismyth-leads-contacts.csv"}),false)]);},
            "restore"=>self.form("Restore permanent memory","Restore into an empty workspace. All restored contacts are inactive; WhatsApp credentials are not imported.","restore",Value::Null,vec![Field::new("Backup JSON path","",false)]),
            "restore-confirm"=>self.confirm("Restore this relationship backup?",action.data.as_str().unwrap_or("").into(),Action::new("request",json!({"path":"/api/restore","body":{"path":action.data},"notice":"Memory restored. Contacts are inactive."}))),
            "runs"=>self.owned_menu("Previous runs","Agent runtime is measured separately from paused/offline time.",list(&self.state,"runs").into_iter().map(|r|(format!("{}  {}  ·  {:.1} min active",clip(strv(&r,"started_at"),19),strv(&r,"status"),r["active_seconds"].as_f64().unwrap_or(0.0)/60.0),Action::new("noop",Value::Null))).collect()),
            "followups"=>{let contacts=list(&self.state,"contacts").into_iter().filter(|c|!strv(c,"next_action").is_empty()||!strv(c,"followup_at").is_empty()).collect::<Vec<_>>();if contacts.is_empty(){self.notice="No follow-up tasks. Add a next action and date from a relationship’s details.".into();}else{self.owned_menu("Relationship follow-ups","Tasks do not automatically authorize messages.",contacts.into_iter().map(|c|(format!("{}  {}  {}",strv(&c,"name"),clip(strv(&c,"followup_at"),16),clip(strv(&c,"next_action"),50)),Action::new("select-id",c["id"].clone()))).collect());}},
            "select-id"=>{self.page(2);if let Some(index)=self.contacts().iter().position(|c|c["id"]==action.data){self.select(index);}},
            "source-key"=>self.form("Connect Firecrawl","Enter your Firecrawl API key. Input is masked and saved privately outside exports. Blank removes the saved key.","source-key",Value::Null,vec![Field::secret("Firecrawl API key")]),
            "source-search"=>self.form("Find Atlas prospects","Search public sources. Firecrawl account credits apply; contacts remain inactive until you enable them.","source-search",Value::Null,vec![Field::new("Search query","real estate brokerage owners",false),Field::new("Location","Pune, India",false),Field::new("Country · two letters","IN",false),Field::new("Result limit · 1–100","5",false)]),
            "source-scrape"|"source-scrape-selected"=>self.form("Inspect a website page","Scrape one source and add its phone contacts to Contacts, with source links. New contacts stay inactive; site contacts are skipped. Firecrawl credits apply.","source-scrape",Value::Null,vec![Field::new("Website URL",if action.name=="source-scrape-selected"{strv(&self.detail,"url")}else{""},false),Field::new("Country calling code for local phones","91",false)]),
            "source-crawl"|"source-crawl-selected"=>self.form("Crawl a whole website","Follow pages within this website. Set a page limit; Firecrawl credits apply. Progress continues in Research runs.","source-crawl",Value::Null,vec![Field::new("Website URL",if action.name=="source-crawl-selected"{strv(&self.detail,"url")}else{""},false),Field::new("Maximum pages · 1–100","10",false),Field::new("Country calling code for local phones","91",false)]),
            "source-actions"=>self.source_actions(),
            "source-select"=>{self.row=action.data.as_u64().unwrap_or(0)as usize;self.thread_scroll=0;self.refresh_detail();},
            "source-credits"=>self.request("/api/sources/credits",json!({}),"Firecrawl credit balance updated.",""),
            "source-contacts"=>self.source_contacts_menu(false,""),
            "source-all-contacts"=>self.source_contacts_menu(true,""),
            "source-companies"=>self.owned_menu("Companies from sources","Contacts stay linked to their stated company. Matching names on unrelated domains remain separate.",list(&self.state["sources"],"companies").into_iter().map(|c|(format!("{} · {} contacts · {}",strv(&c,"name"),num(&c,"contacts"),strv(&c,"website")),Action::new("source-company",c))).collect()),
            "source-company"=>self.source_contacts_menu(true,strv(&action.data,"key")),
            "source-contact-detail"=>{let c=action.data;let mut items=vec![(format!("Type: {}",strv(&c,"kind")),Action::new("source-contact-detail",c.clone())),(format!("Name: {}",strv(&c,"name")),Action::new("source-contact-detail",c.clone())),(format!("Role: {}",strv(&c,"role")),Action::new("source-contact-detail",c.clone())),(format!("Company: {}",strv(&c,"company")),Action::new("source-contact-detail",c.clone())),(format!("Phone: {}",strv(&c,"phone")),Action::new("source-contact-detail",c.clone())),(format!("Email: {}",strv(&c,"email")),Action::new("source-contact-detail",c.clone()))];if let Some(saved)=list(&self.state,"contacts").into_iter().find(|saved|saved["phone"]==c["phone"]){items.push(("Open saved relationship".into(),Action::new("source-open-crm",saved)));}
if !strv(&c,"phone").is_empty(){items.push(("Import this phone contact".into(),Action::new("source-import",json!({"page_id":c["sources"][0]["page_id"],"phone":c["phone"]}))));}for source in list(&c,"sources"){items.push((format!("Source: {}",strv(&source,"url")),Action::new("source-open",source)));}if !strv(&c,"company_key").is_empty(){items.push(("See everyone at this company".into(),Action::new("source-company",json!({"key":c["company_key"]}))));}self.owned_menu("Contact & company relationship","Missing fields were not stated. A shared phone imports once with all associated people in its notes; email-only records remain in research.",items);},
            "source-open-crm"=>{let id=strv(&action.data,"id").to_owned();self.page(2);self.detail_tab=0;if let Some(index)=self.contacts().iter().position(|c|strv(c,"id")==id){self.select(index);}},
            "source-open"=>{let rows=self.source_pages();if let Some(i)=rows.iter().position(|p|p["id"]==action.data["page_id"]){self.row=i;self.thread_scroll=0;self.refresh_detail();}},
            "source-import"=>self.confirm("Import this sourced phone?",format!("{}\n\nSave the extracted name, company, role, email and source evidence. Shared numbers become one relationship with associated people in its notes. Existing contacts keep their data and permissions.",strv(&action.data,"phone")),Action::new("request",json!({"path":"/api/sources/import","body":action.data,"notice":"Sourced contact imported. New leads are inactive."}))),
            "source-collect"=>self.form("Collect contacts from saved results","Batch scrape discovered pages with named contact extraction. Discovered and older unnamed pages are collected. Optional refresh re-scrapes saved pages. Firecrawl credits apply.","source-collect",Value::Null,vec![Field::new("Maximum saved pages · 1–100","10",false),Field::new("Country calling code","91",false),Field::new("Refresh already scraped pages · yes/no","no",false)]),
            "source-manage"=>self.menu("Manage sources","Research deletion preserves imported CRM relationships. Cancel running jobs before deleting.",vec![("Reprocess saved directories · no credits",Action::new("request",json!({"path":"/api/sources/reprocess","body":{"all":true},"notice":"Saved directories reprocessed locally."}))),("Import all saved phone contacts",Action::new("source-import-all",json!({"all":true}))),("Export all sourced contacts as JSON",Action::new("source-export",Value::Null)),("Delete selected source",Action::new("source-delete",json!({"page_ids":[self.detail["id"]]}))),("Delete all saved sources",Action::new("source-delete",json!({"all":true})))]),
            "source-import-all"=>self.confirm("Import sourced phone contacts?","Save all unique phones in this selection as inactive relationships. Names, companies, roles, emails and source evidence are preserved. Shared phones import once; existing contacts remain unchanged. Records without a phone stay in research/exports. Website-wide directory contacts are skipped by bulk import.".into(),Action::new("request",json!({"path":"/api/sources/import-all","body":action.data,"notice":"Source phone import completed."}))),
            "source-delete"=>{let selection=if action.data["all"].as_bool().unwrap_or(false){format!("ALL {} saved source pages",num(&self.state["sources"],"count"))}else{format!("{}\n{}",strv(&self.detail,"title"),strv(&self.detail,"url"))};self.confirm("Delete saved sources?",format!("Remove {selection} and extracted contact/company evidence.\n\nImported CRM contacts, conversations and memory remain saved. Run history and older backups retain historical records."),Action::new("request",json!({"path":"/api/sources/delete","body":action.data,"notice":"Sources deleted. Imported relationships preserved."})));},
            "source-export"=>{let home=std::env::var("HOME").unwrap_or(".".into());self.form("Export sourced contacts","Includes names, companies, roles, phones, emails, company grouping and source evidence, including email-only contacts.","export",json!({"sources":true}),vec![Field::new("Save JSON path",&format!("{home}/oracle-sourced-contacts.json"),false)]);},
            "source-runs"=>self.owned_menu("Research runs","Crawls and contact batches resume checking the saved job after restart. Select a run for progress or cancellation.",list(&self.state["sources"],"runs").into_iter().map(|r|(format!("{}  {}  {}/{}  {}",strv(&r,"kind"),strv(&r,"status"),num(&r,"completed"),num(&r,"page_limit"),clip(strv(&r,"target"),45)),Action::new("source-run",r))).collect()),
            "source-run"=>{let r=action.data;let hint=format!("{} · {} / {} pages · credits {}\n{}",strv(&r,"target"),num(&r,"completed"),num(&r,"page_limit"),r["credits"],strv(&r,"error"));let mut items=vec![("Refresh research status",Action::new("request",json!({"path":"/api/sources/refresh","body":{},"notice":"Crawl progress checked."})))];if matches!(strv(&r,"status"),"running"|"collecting"){items.push(("Cancel this research job",Action::new("request",json!({"path":"/api/sources/cancel","body":{"id":r["id"]},"notice":"Crawl cancellation confirmed."}))));}self.menu("Research progress",&hint,items);},
            "help"=>self.modal=Some(Modal::Help),
            "request"=>self.request(strv(&action.data,"path"),action.data["body"].clone(),strv(&action.data,"notice"),strv(&action.data,"next")),
            "export-save"=>self.save_export(strv(&action.data,"path"),action.data["backup"].as_bool().unwrap_or(false),action.data["sources"].as_bool().unwrap_or(false)),
            "quit"=>self.quit=true,
            _=>{}
        }
    }
    pub fn submit_form(&mut self, send: bool) {
        if self.busy {
            self.notice = "Finish the current operation first. Your editor is preserved.".into();
            return;
        }
        let original_form = self.modal.clone();
        let Some(Modal::Form {
            kind, data, fields, ..
        }) = self.modal.clone()
        else {
            return;
        };
        let values = fields
            .iter()
            .map(|f| f.edit.text().trim().to_owned())
            .collect::<Vec<_>>();
        let first = values.first().cloned().unwrap_or_default();
        self.modal = None;
        let result = (|| -> Result<(), String> {
            match kind.as_str() {
                "source-key" => self.request(
                    "/api/sources/key",
                    json!({"api_key":first}),
                    "Firecrawl key configuration saved.",
                    "",
                ),
                "source-search" => {
                    let limit = values[3]
                        .parse::<u32>()
                        .map_err(|_| "Enter a whole-number result limit.")?;
                    self.request("/api/sources/search",json!({"query":values[0],"location":values[1],"country":values[2],"limit":limit}),"Search results saved. Select a page to inspect it.","");
                }
                "source-scrape" => self.request(
                    "/api/sources/scrape",
                    json!({"url":values[0],"dial_code":values[1],"import_contacts":true}),
                    "Source saved and phone contacts added.",
                    "source-result",
                ),
                "source-crawl" => {
                    let limit = values[1]
                        .parse::<u32>()
                        .map_err(|_| "Enter a whole-number page limit.")?;
                    self.request(
                        "/api/sources/crawl",
                        json!({"url":values[0],"limit":limit,"dial_code":values[2]}),
                        "Website crawl started. See Research runs for progress.",
                        "",
                    );
                }
                "source-collect" => {
                    let limit = values[0]
                        .parse::<u32>()
                        .map_err(|_| "Enter a whole-number page limit.")?;
                    self.request(
                        "/api/sources/collect",
                        json!({"all":true,"limit":limit,"dial_code":values[1],"refresh":values[2].eq_ignore_ascii_case("yes")}),
                        "Contact collection started. Check Runs for progress.",
                        "",
                    );
                }
                "pair-phone" => {
                    if first.is_empty() {
                        return Err("Enter your WhatsApp number including country code.".into());
                    }
                    self.modal = Some(Modal::Qr);
                    self.request(
                        "/api/whatsapp/pair-phone",
                        json!({"phone":first}),
                        "Pairing request finished. Check the code or error above.",
                        "",
                    );
                }
                "search" => {
                    self.search = first;
                    self.row = 0;
                    self.refresh_detail();
                }
                "setting" => {
                    let key = data.as_str().unwrap_or("");
                    let value = if key == "daily_limit" {
                        json!(
                            first
                                .parse::<u32>()
                                .map_err(|_| "Enter a whole-number daily limit.")?
                        )
                    } else {
                        json!(first)
                    };
                    self.request("/api/settings", json!({key:value}), "Setting saved.", "");
                }
                "delay" => {
                    let min = values[0]
                        .parse::<u32>()
                        .map_err(|_| "Enter whole-number seconds.")?;
                    let max = values[1]
                        .parse::<u32>()
                        .map_err(|_| "Enter whole-number seconds.")?;
                    self.request(
                        "/api/settings",
                        json!({"reply_delay_min":min,"reply_delay_max":max}),
                        "Response timing saved.",
                        "",
                    );
                }
                "quiet" => {
                    let start = values[0]
                        .parse::<u32>()
                        .map_err(|_| "Enter a start hour from 0 to 23.")?;
                    let end = values[1]
                        .parse::<u32>()
                        .map_err(|_| "Enter an end hour from 0 to 23.")?;
                    self.request(
                        "/api/settings",
                        json!({"quiet_start":start,"quiet_end":end}),
                        "Quiet hours saved.",
                        "",
                    );
                }
                "contact" => {
                    let keys = [
                        "name",
                        "company",
                        "role",
                        "source",
                        "notes",
                        "next_action",
                        "followup_at",
                    ];
                    let patch: serde_json::Map<String, Value> = keys
                        .into_iter()
                        .zip(values)
                        .map(|(k, v)| (k.into(), json!(v)))
                        .collect();
                    self.request(
                        "/api/contact/update",
                        json!({"id":data,"patch":patch}),
                        "Relationship updated.",
                        "",
                    );
                }
                "memory" => self.request(
                    "/api/memory",
                    json!({"contact_id":data,"content":first}),
                    "Permanent relationship memory saved.",
                    "",
                ),
                "memory-edit" => {
                    if first.is_empty() {
                        self.confirm("Delete this memory?","Original conversation messages will remain.".into(),Action::new("request",json!({"path":"/api/memory/delete","body":{"id":data["id"]},"notice":"Memory deleted."})));
                    } else {
                        self.request(
                            "/api/memory/update",
                            json!({"id":data["id"],"content":first}),
                            "Operator correction saved.",
                            "",
                        );
                    }
                }
                "meeting" => self.request(
                    "/api/meeting",
                    json!({"contact_id":data,"title":values[0],"starts_at":values[1]}),
                    "Local meeting saved. No external invitation was sent.",
                    "",
                ),
                "write" => self.request(
                    "/api/message",
                    json!({"contact_id":data,"text":first}),
                    "Message ready for automatic sending when the agent is running.",
                    "",
                ),
                "review" => {
                    if send {
                        self.perform(Action::new(
                            "review-send",
                            json!({"id":data["id"],"text":first}),
                        ));
                    } else {
                        self.request(
                            "/api/draft/review",
                            json!({"id":data["id"],"text":first,"send":false}),
                            "Draft saved without sending.",
                            "",
                        );
                    }
                }
                "import" => {
                    let path = expand(&first);
                    if std::fs::metadata(&path)
                        .map_err(|_| "Contact file could not be opened.")?
                        .len()
                        > 5_000_000
                    {
                        return Err("Choose a contact file smaller than 5 MB.".into());
                    }
                    let raw = std::fs::read_to_string(&path)
                        .map_err(|_| "Contact file could not be read as UTF-8.")?;
                    let body = if path.ends_with(".json") {
                        let parsed: Value =
                            serde_json::from_str(&raw).map_err(|_| "Invalid contact JSON.")?;
                        json!({"contacts":if parsed.is_array(){parsed}else{parsed["contacts"].clone()}})
                    } else {
                        json!({"csv":raw})
                    };
                    self.request(
                        "/api/import",
                        body,
                        "Contacts imported; all new contacts are inactive.",
                        "import",
                    );
                }
                "export" => {
                    let path = expand(&first);
                    let backup = data.as_bool().unwrap_or(false);
                    if std::path::Path::new(&path).exists() {
                        self.confirm(
                            "Overwrite this export file?",
                            path.clone(),
                            Action::new(
                                "export-save",
                                json!({"path":path,"backup":backup,"sources":data["sources"]}),
                            ),
                        );
                    } else {
                        self.save_export(&path, backup, data["sources"].as_bool().unwrap_or(false));
                    }
                }
                "restore" => self.perform(Action::new("restore-confirm", json!(expand(&first)))),
                _ => {}
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.modal = original_form;
            self.notice = error;
        }
    }
    fn save_export(&mut self, path: &str, backup: bool, sources: bool) {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let result = (|| -> Result<(), String> {
            let content = if sources {
                serde_json::to_string_pretty(&self.api.get("/api/sources/export")?)
                    .map_err(|_| "Could not encode sourced contacts.")?
            } else if backup {
                serde_json::to_string_pretty(&self.api.get("/api/export")?)
                    .map_err(|_| "Could not encode backup.")?
            } else if path.ends_with(".csv") {
                self.api.export_csv()?
            } else {
                serde_json::to_string_pretty(&json!({"contacts":self.state["contacts"]}))
                    .map_err(|_| "Could not encode contacts.")?
            };
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .mode(0o600)
                .open(path)
                .map_err(|_| "Could not open the export path.")?;
            std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600))
                .map_err(|_| "Could not secure the export file.")?;
            file.write_all(content.as_bytes())
                .map_err(|_| "Could not save the export.")?;
            Ok(())
        })();
        self.notice = match result {
            Ok(()) => format!("Saved {path}"),
            Err(e) => e,
        };
    }
}
pub fn expand(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        format!("{}/{}", std::env::var("HOME").unwrap_or(".".into()), rest)
    } else {
        path.into()
    }
}

#[cfg(test)]
mod directory_tests {
    use super::*;
    #[test]
    fn live_search_accepts_names_cross_field_terms_and_formatted_phone_numbers() {
        let c = json!({"name":"Asha Kapoor","phone":"+919876543210","company":"North Homes","role":"Owner","stage":"interested","notes":"Tuesday demo"});
        for query in [
            "",
            "ASHA",
            "asha homes",
            "owner",
            "Tuesday",
            "+91 (987) 654-3210",
            "987654",
            "interested",
        ] {
            assert!(contact_matches(&c, query), "{query}");
        }
        for query in ["Other person", "001199", "missing company"] {
            assert!(!contact_matches(&c, query), "{query}");
        }
    }
    #[test]
    fn a_short_number_in_a_name_does_not_match_every_phone_prefix() {
        let c = json!({"name":"Fixture 39","phone":"+12025550039"});
        assert!(contact_matches(&c, "fixture 39"));
        assert!(!contact_matches(&c, "fixture 02"));
    }
}
