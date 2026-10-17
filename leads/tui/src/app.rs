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
}
impl Field {
    pub fn new(label: &str, value: &str, multiline: bool) -> Self {
        Self {
            label: label.into(),
            edit: Editor::new(value),
            multiline,
        }
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
    pub settings_row: usize,
    pub quit: bool,
    pub last_refresh: Instant,
    pub tick: u64,
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
            settings_row: 0,
            quit: false,
            last_refresh: Instant::now(),
            tick: 0,
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
            Ok(v) => self.state = v,
            Err(e) => self.notice = e,
        };
        self.last_refresh = Instant::now();
        self.refresh_detail();
    }
    pub fn refresh_detail(&mut self) {
        let rows = self.contacts();
        if !rows.is_empty() {
            self.row = self.row.min(rows.len() - 1);
            let id = strv(&rows[self.row], "id");
            if let Ok(v) = self.api.get(&format!("/api/contact/{id}")) {
                self.selected_id = id.into();
                self.detail = v;
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
                let hay = format!(
                    "{} {} {} {}",
                    strv(c, "name"),
                    strv(c, "company"),
                    strv(c, "phone"),
                    strv(c, "stage")
                )
                .to_lowercase();
                scoped && (self.search.is_empty() || hay.contains(&self.search.to_lowercase()))
            })
            .collect();
        rows.sort_by_cached_key(|c| (strv(c, "name").to_lowercase(), strv(c, "phone").to_owned()));
        rows
    }
    pub fn contact(&self) -> Value {
        self.detail["contact"].clone()
    }
    pub fn page(&mut self, index: usize) {
        self.page = index;
        self.row = 0;
        self.search.clear();
        self.composer_focus = false;
        self.thread_scroll = 0;
        self.refresh_detail();
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
                    self.notice = if done.next == "import" {
                        format!(
                            "Imported {} contacts · {} duplicates · {} invalid. New contacts are inactive.",
                            num(&value, "added"),
                            num(&value, "duplicates"),
                            list(&value, "errors").len()
                        )
                    } else if done.next == "provider" {
                        strv(&value, "detail").into()
                    } else {
                        done.notice
                    };
                    self.last_refresh = Instant::now() - Duration::from_secs(2);
                    self.refresh();
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
                (
                    "Generate an opening draft",
                    Action::new("generate", Value::Null),
                ),
                ("Write a message", Action::new("write", Value::Null)),
                (
                    "Review drafts and uncertain sends",
                    Action::new("jobs", Value::Null),
                ),
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
        let jobs = list(&self.detail, "jobs");
        if jobs.is_empty() {
            self.notice = "No drafts or unresolved sends for this relationship.".into();
            return;
        }
        let items = jobs
            .into_iter()
            .map(|j| {
                (
                    format!(
                        "{}  {}",
                        strv(&j, "status").to_uppercase(),
                        clip(strv(&j, "text"), 65)
                    ),
                    Action::new("job", j),
                )
            })
            .collect();
        self.owned_menu("Drafts and send operations","Opening messages always require exact review. Uncertain sends are never retried automatically.",items);
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
                "Incoming reply mode",
                strv(s, "reply_mode").into(),
                "reply_mode",
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
            "reply_mode" => self.menu(
                "Incoming replies",
                "Opening messages always require separate review.",
                vec![
                    (
                        "Review each proposed reply",
                        Action::new("settings-save", json!({"reply_mode":"review"})),
                    ),
                    (
                        "Automatically reply within the active scope",
                        Action::new("settings-save", json!({"reply_mode":"auto"})),
                    ),
                ],
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
            "toggle-agent"=>self.request("/api/settings",json!({"automation_paused":!self.state["settings"]["automation_paused"].as_bool().unwrap_or(true)}),"Agent state updated.",""),
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
            "generate"=>self.request("/api/draft/generate",json!({"contact_id":cid}),"Opening draft prepared. Review it before sending.","draft-created"),
            "write"=>self.form("Write a message",&format!("To {} · {}. This creates a draft, not a send.",strv(&c,"name"),strv(&c,"phone")),"write",json!(cid),vec![Field::new("Message","",true)]),
            "jobs"=>self.review_jobs(),
            "job"=>{let j=action.data;match strv(&j,"status"){
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
            "stage"=>{let stages=["new","contacted","replied","interested","meeting_requested","meeting_booked","pilot","client","not_interested"];self.owned_menu("Relationship stage","Meeting requested, booked and completed are different outcomes.",stages.into_iter().map(|stage|(stage.replace('_'," "),Action::new("request",json!({"path":"/api/contact/update","body":{"id":cid,"patch":{"stage":stage}},"notice":"Relationship stage updated."})))).collect());},
            "optout"=>self.confirm("Record an opt-out?",format!("Stop outreach to {}. This disables scope and cancels queued work.",strv(&c,"name")),Action::new("request",json!({"path":"/api/contact/update","body":{"id":cid,"patch":{"opted_out":true}},"notice":"Opt-out recorded. Outreach stopped."}))),
            "delete-contact"=>self.confirm("Delete this relationship?",format!("Delete {} and their local messages, memories, meetings and jobs. Existing backup snapshots may retain older copies.",strv(&c,"name")),Action::new("request",json!({"path":"/api/contact/delete","body":{"id":cid},"notice":"Relationship deleted."}))),
            "new-meeting"=>self.form("Create a local meeting","Include a timezone in the ISO date, e.g. 2030-01-01T10:00:00+05:30. No calendar invitation is sent.","meeting",json!(cid),vec![Field::new("Title","Atlas walkthrough",false),Field::new("Date and time · ISO format","",false)]),
            "meetings"=>self.meetings(action.data.as_bool().unwrap_or(false)),
            "meeting"=>{let m=action.data;let mut items=vec![];for status in ["booked","successful","unsuccessful","cancelled"]{items.push((format!("Mark {status}"),Action::new("request",json!({"path":"/api/meeting/update","body":{"id":m["id"],"status":status},"notice":"Meeting outcome saved."}))));}items.push(("Delete meeting record".into(),Action::new("meeting-delete",m)));self.owned_menu("Meeting outcome","Configured outcome links are prepared only while the contact remains in scope.",items);},
            "meeting-delete"=>self.confirm("Delete meeting record?",strv(&action.data,"title").into(),Action::new("request",json!({"path":"/api/meeting/delete","body":{"id":action.data["id"]},"notice":"Meeting record deleted."}))),
            "pair-phone"=>self.form("Link with phone number instead","Enter your WhatsApp number including country code. You will enter the displayed pairing code on your phone.","pair-phone",Value::Null,vec![Field::new("WhatsApp number · +country code",strv(&self.state["whatsapp"],"pairing_phone"),false)]),
            "connect"=>{self.modal=Some(Modal::Qr);self.request("/api/whatsapp/connect",json!({}),"WhatsApp connection requested.","");},
            "disconnect"=>self.request("/api/whatsapp/disconnect",json!({}),"WhatsApp disconnected. Agent paused.",""),
            "unlink"=>self.confirm("Unlink WhatsApp?","Remove the local pairing and deactivate all contacts. You can also remove Oracle Leads from Linked devices on your phone.".into(),Action::new("request",json!({"path":"/api/whatsapp/unlink","body":{},"notice":"WhatsApp unlinked."}))),
            "import"=>self.form("Import contacts","CSV columns: name,phone,company,role,source,notes. Numbers need +country code. JSON arrays are also supported.","import",Value::Null,vec![Field::new("Local file path","",false)]),
            "legacy"=>self.confirm("Import Bismyth saved contacts?","Read contacts from your older Bismyth Leads runs. Originals stay unchanged. All imported contacts start inactive.".into(),Action::new("request",json!({"path":"/api/import-legacy","body":{},"notice":"Older contacts imported.","next":"import"}))),
            "search"=>self.form("Find a relationship","Search by name, company, number or stage.","search",Value::Null,vec![Field::new("Search",&self.search,false)]),
            "export"|"backup"=>{let backup=action.name=="backup";let home=std::env::var("HOME").unwrap_or(".".into());self.form(if backup{"Export relationship backup"}else{"Export contacts"},"Saved privately on this computer. Backups exclude WhatsApp credentials.","export",json!(backup),vec![Field::new("Save path",&format!("{home}/{}",if backup{"oracle-leads-backup.json"}else{"bismyth-leads-contacts.csv"}),false)]);},
            "restore"=>self.form("Restore permanent memory","Restore into an empty workspace. All restored contacts are inactive; WhatsApp credentials are not imported.","restore",Value::Null,vec![Field::new("Backup JSON path","",false)]),
            "restore-confirm"=>self.confirm("Restore this relationship backup?",action.data.as_str().unwrap_or("").into(),Action::new("request",json!({"path":"/api/restore","body":{"path":action.data},"notice":"Memory restored. Contacts are inactive."}))),
            "runs"=>self.owned_menu("Previous runs","Agent runtime is measured separately from paused/offline time.",list(&self.state,"runs").into_iter().map(|r|(format!("{}  {}  ·  {:.1} min active",clip(strv(&r,"started_at"),19),strv(&r,"status"),r["active_seconds"].as_f64().unwrap_or(0.0)/60.0),Action::new("noop",Value::Null))).collect()),
            "followups"=>{let contacts=list(&self.state,"contacts").into_iter().filter(|c|!strv(c,"next_action").is_empty()||!strv(c,"followup_at").is_empty()).collect::<Vec<_>>();if contacts.is_empty(){self.notice="No follow-up tasks. Add a next action and date from a relationship’s details.".into();}else{self.owned_menu("Relationship follow-ups","Tasks do not automatically authorize messages.",contacts.into_iter().map(|c|(format!("{}  {}  {}",strv(&c,"name"),clip(strv(&c,"followup_at"),16),clip(strv(&c,"next_action"),50)),Action::new("select-id",c["id"].clone()))).collect());}},
            "select-id"=>{self.page(2);if let Some(index)=self.contacts().iter().position(|c|c["id"]==action.data){self.select(index);}},
            "help"=>self.modal=Some(Modal::Help),
            "request"=>self.request(strv(&action.data,"path"),action.data["body"].clone(),strv(&action.data,"notice"),strv(&action.data,"next")),
            "export-save"=>self.save_export(strv(&action.data,"path"),action.data["backup"].as_bool().unwrap_or(false)),
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
                    "/api/draft",
                    json!({"contact_id":data,"text":first}),
                    "Message saved as a draft.",
                    "draft-created",
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
                            Action::new("export-save", json!({"path":path,"backup":backup})),
                        );
                    } else {
                        self.save_export(&path, backup);
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
    fn save_export(&mut self, path: &str, backup: bool) {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let result = (|| -> Result<(), String> {
            let content = if backup {
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
