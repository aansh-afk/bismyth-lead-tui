#!/usr/bin/env python3
"""Oracle Leads terminal workspace. All outreach state belongs to the local service."""
import argparse
import collections
import curses
import datetime as dt
import http.cookiejar
import json
import os
import platform
from pathlib import Path
import queue
import select
import shutil
import signal
import subprocess
import sys
import textwrap
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
PAGES = ['Dashboard', 'WhatsApp', 'Contacts', 'Settings']
STAGES = ['new', 'contacted', 'replied', 'interested', 'meeting_requested', 'meeting_booked', 'pilot', 'client', 'not_interested']


def node_binary():
    candidates = [shutil.which('node')]
    nvm = Path.home() / '.nvm/versions/node'
    if nvm.exists():
        candidates = sorted(nvm.glob('v24*/bin/node'), reverse=True) + candidates
    for candidate in candidates:
        if candidate:
            try:
                version = subprocess.check_output([str(candidate), '--version'], text=True, timeout=5)
                if int(version.lstrip('v').split('.')[0]) >= 24:
                    return str(candidate)
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
    raise RuntimeError('Oracle Leads requires Node.js 24+. Install it, then run bismyth-leads again.')


class API:
    def __init__(self, base, key):
        self.base = base
        self.key = key
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.call('/api/bootstrap')

    def call(self, path, body=None, timeout=200):
        headers = {'X-Oracle-Request': '1', 'Content-Type': 'application/json'}
        if path == '/api/bootstrap': headers['X-Oracle-Key'] = self.key
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                data = response.read().decode()
                return data if 'text/csv' in response.headers.get('Content-Type', '') else json.loads(data)
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read()).get('error', 'Request failed.')
            except (ValueError, OSError):
                message = 'Request failed.'
            raise RuntimeError(message) from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError('The local Oracle Leads service is unavailable.') from None


class TUI:
    def __init__(self, screen, api, provider=None):
        self.s, self.api = screen, api
        self.page, self.row, self.state = 0, 0, {}
        self.notice = 'Welcome. Import contacts, pair WhatsApp, then explicitly enable your outreach scope.'
        self.events = queue.Queue()
        self.pending = False
        self.search = ''
        self.provider = provider
        self.last_refresh = 0
        curses.curs_set(0)
        curses.use_default_colors()
        for number, fg, bg in [(1,curses.COLOR_CYAN,-1),(2,curses.COLOR_BLACK,curses.COLOR_CYAN),(3,curses.COLOR_WHITE,-1),(4,curses.COLOR_GREEN,-1),(5,curses.COLOR_YELLOW,-1),(6,curses.COLOR_RED,-1),(7,curses.COLOR_BLACK,curses.COLOR_WHITE),(8,curses.COLOR_WHITE,curses.COLOR_BLACK)]:
            curses.init_pair(number, fg, bg)
        screen.timeout(300)

    def put(self, y, x, value, color=0, width=None):
        h, w = self.s.getmaxyx()
        if 0 <= y < h and 0 <= x < w:
            clean = ''.join(c if c.isprintable() else ' ' for c in str(value))
            try:
                self.s.addnstr(y, x, clean, max(0, min(width or w-x-1, w-x-1)), curses.color_pair(color))
            except curses.error:
                pass

    def lines(self, y, x, content, width=None, limit=None, color=0):
        h,w = self.s.getmaxyx()
        width = max(10, width or w-x-3)
        rendered = []
        for line in str(content).splitlines() or ['']:
            rendered.extend(textwrap.wrap(line, width=width, replace_whitespace=False) or [''])
        for index, line in enumerate(rendered[:limit or max(0,h-y-3)]):
            self.put(y+index, x, line, color)
        return y + min(len(rendered), limit or max(0,h-y-3))

    def refresh(self, force=False):
        if force or time.monotonic()-self.last_refresh > 1.3:
            self.state = self.api.call('/api/state', timeout=8)
            self.last_refresh = time.monotonic()

    def background(self, path, body=None, message='Done.'):
        if self.pending:
            self.notice = 'One operation is already running. You can continue browsing.'
            return
        self.pending = True
        def run():
            try:
                result = self.api.call(path, body)
                detail = result.get('detail', '') if isinstance(result, dict) else ''
                self.events.put(message + (' ' + detail if detail else ''))
            except Exception as error:
                self.events.put(str(error))
        threading.Thread(target=run, daemon=True).start()

    def edit(self, label, initial='', multiline=False):
        value, cursor, offset = str(initial), len(str(initial)), 0
        self.s.timeout(-1)
        try:
            while True:
                self.s.erase()
                h,w = self.s.getmaxyx()
                self.put(1,2,label,1)
                self.put(2,2,'Ctrl+G saves · Esc cancels' if multiline else 'Enter saves · Esc cancels',5)
                content_width = max(10,w-6)
                # Map source positions to screen cells; preserve explicit newlines.
                positions, rows, col, row = [], [''], 0, 0
                for character in value:
                    positions.append((row,col))
                    if character == '\n':
                        row += 1; col = 0; rows.append('')
                    else:
                        rows[row] += character; col += 1
                        if col >= content_width:
                            row += 1; col = 0; rows.append('')
                positions.append((row,col))
                cy,cx = positions[cursor]
                if cy < offset: offset = cy
                if cy >= offset+h-7: offset = cy-(h-8)
                for index,line in enumerate(rows[offset:offset+h-7]): self.put(4+index,3,line)
                curses.curs_set(1)
                try: self.s.move(min(h-3,4+cy-offset), min(w-2,3+cx))
                except curses.error: pass
                self.s.refresh()
                try: key = self.s.get_wch()
                except curses.error: continue
                if key == '\x1b': return None
                if key == '\x15': value=''; cursor=0; offset=0; continue
                if key == '\x07' or (not multiline and key in ('\n','\r')): return value.strip()
                if key in (curses.KEY_BACKSPACE,'\x7f','\b'):
                    if cursor: value=value[:cursor-1]+value[cursor:]; cursor-=1
                elif key == curses.KEY_DC: value=value[:cursor]+value[cursor+1:]
                elif key == curses.KEY_LEFT: cursor=max(0,cursor-1)
                elif key == curses.KEY_RIGHT: cursor=min(len(value),cursor+1)
                elif key == curses.KEY_HOME: cursor=value.rfind('\n',0,cursor)+1
                elif key == curses.KEY_END:
                    found=value.find('\n',cursor); cursor=found if found>=0 else len(value)
                elif key == curses.KEY_UP: cursor=max(0,cursor-content_width)
                elif key == curses.KEY_DOWN: cursor=min(len(value),cursor+content_width)
                elif isinstance(key,str) and (key.isprintable() or (multiline and key in ('\n','\r'))):
                    key='\n' if key=='\r' else key; value=value[:cursor]+key+value[cursor:];cursor+=len(key)
        finally:
            curses.curs_set(0); self.s.timeout(300)

    def choose(self, title, choices, current=0):
        selected = current
        while True:
            self.s.erase(); self.put(2,3,title,1)
            height,_=self.s.getmaxyx();visible=max(1,(height-9)//2);start=max(0,selected-visible+1)
            for i, label in enumerate(choices[start:start+visible],start): self.put(5+(i-start)*2,4,('› ' if i==selected else '  ')+label,2 if i==selected else 0)
            self.put(height-2,4,'↑/↓ choose · Enter select · Esc back',5)
            self.s.refresh(); key=self.s.getch()
            if key in (27,ord('q')): return None
            if key in (curses.KEY_UP,ord('k')): selected=(selected-1)%len(choices)
            if key in (curses.KEY_DOWN,ord('j')): selected=(selected+1)%len(choices)
            if key in (10,13): return selected
            if ord('1')<=key<ord('1')+len(choices): return key-ord('1')

    def confirm(self,label,word='YES'):
        return self.edit(label+f' Type {word} to confirm.') == word

    def select_provider(self):
        selected = {'codex':0,'selfhost':1}.get(self.provider)
        if selected is None:
            selected=self.choose('ORACLE LEADS  /  Choose this run’s provider. Your relationship memory stays the same.', ['Codex subscription — use your existing ChatGPT sign-in','Self-hosted model — use the configured Oracle endpoint'])
        if selected is None: return False
        self.api.call('/api/settings',{'provider':['codex','selfhost'][selected], 'automation_paused':True})
        self.background('/api/provider', message='Provider check:')
        return True

    def contacts(self, scoped=False):
        rows=self.state.get('contacts',[])
        if scoped: rows=[c for c in rows if c['active'] and c['sender']==self.state.get('whatsapp',{}).get('phone')]
        term=self.search.lower()
        return [c for c in rows if not term or term in ' '.join(str(c.get(k,'')) for k in ['name','phone','company','stage']).lower()]

    def frame(self):
        self.s.erase(); h,w=self.s.getmaxyx()
        if h<20 or w<70:
            self.put(2,2,'Oracle Leads needs a terminal at least 70 columns × 20 rows.',5)
            self.put(4,2,'Resize the terminal, or press Q to quit.');return None
        self.put(1,2,'◈ ORACLE LEADS',1)
        self.put(1,max(23,w-40),self.state.get('settings',{}).get('provider','codex').upper()+'  ·  '+('PAUSED' if self.state.get('settings',{}).get('automation_paused',True) else 'AGENT RUNNING'),5 if self.state.get('settings',{}).get('automation_paused',True) else 4)
        for i,label in enumerate(PAGES): self.put(3,2+i*17,f' {i+1} {label} ',2 if self.page==i else 0)
        self.put(5,2,'─'*(w-4),1)
        self.put(h-3,2,self.notice,5,width=w-4)
        self.put(h-2,2,('Working…  ' if self.pending else '')+'1–4 pages  ·  Space start/pause agent  ·  R refresh  ·  Q quit',3)
        return h,w

    def dashboard(self,h,w):
        a=self.state['analytics']
        metrics=[('CONTACTS',a['contacts']),('INTERESTED',a['interested']),('WANT MEETING',a['meeting_requests']),('BOOKED',a['meetings']),('CLIENTS',a['clients'])]
        step=(w-4)//len(metrics)
        for i,(label,value) in enumerate(metrics): self.put(7,2+i*step,label,3);self.put(8,2+i*step,str(value),1)
        current=next((r for r in self.state['runs'] if r['id']==self.state['run_id']),{})
        due=sum(1 for c in self.state['contacts']if c.get('followup_at')and c['followup_at']<=dt.datetime.now(dt.timezone.utc).isoformat())
        self.put(10,2,f"Sent {a['sent']}  ·  Replies {a['replies']}  ·  Drafts {a['drafts']}  ·  Follow-ups due {due}  ·  Agent active {current.get('active_seconds',0)/3600:.2f}h")
        self.put(12,2,'RECENT ACTIVITY',1)
        for index,event in enumerate(self.state['activity'][:max(2,(h-19)//2)]): self.put(14+index,2,event['created_at'][11:19]+'  '+event['detail'])
        self.put(h-6,2,'C Chat with Oracle  ·  M Meetings  ·  H Previous runs',1)
        assistant=next((m['text'] for m in reversed(self.state['chat']) if m['role']=='assistant'),None)
        if assistant:self.put(h-5,2,'Oracle: '+assistant)

    def contacts_page(self,h,w,whatsapp=False):
        rows=self.contacts(scoped=whatsapp)
        self.row=min(self.row,max(0,len(rows)-1))
        if whatsapp:
            wa=self.state['whatsapp'];self.put(7,2,f"WHATSAPP  {wa['status'].upper()}  {wa.get('phone') or 'No account paired'}",4 if wa['status']=='connected' else 5)
            self.put(8,2,'C Connect / QR  ·  X Disconnect  ·  U Unlink  ·  Enter Conversation',1)
            if wa.get('error'):self.put(9,2,wa['error'],5)
        else:
            self.put(7,2,f"CONTACTS  {len(rows)} relationships  ·  {self.state['analytics']['active']} active",1)
            self.put(8,2,'I Import file  ·  L Import Bismyth runs  ·  E Export  ·  / Search  ·  Enter Profile',1)
        self.put(11,2,f"{'NAME':<23} {'COMPANY':<22} {'STAGE':<19} ACCESS",3)
        if not rows:
            self.put(14,3,'No active outreach contacts.' if whatsapp else 'Your relationship workspace is empty.',1)
            self.put(16,3,'Pair your number, then enable selected contacts on page 3.' if whatsapp else 'Press I to import a CSV or JSON file. New contacts always start inactive.')
        visible=max(1,h-18);start=max(0,self.row-visible+1)
        for index,c in enumerate(rows[start:start+visible],start):
            access='OPTED OUT' if c['opted_out'] else 'ACTIVE' if c['active'] else 'INACTIVE'
            label=f"{c['name'][:22]:<23} {c['company'][:21]:<22} {c['stage'][:18]:<19} {access}"
            self.put(13+index-start,2,label,2 if index==self.row else 0)

    def settings_page(self,h,w):
        s=self.state['settings'];self.put(7,2,'WORKSPACE SETTINGS',1)
        rows=[('P Provider',s['provider']),('S Sales instructions',s['system_prompt'][:80]),('K Atlas knowledge',s['knowledge'][:80]),('A Reply mode',s['reply_mode']),('D Daily send limit',str(s['daily_limit'])),('T Quiet hours (local time)',f"{s['quiet_start']:02d}:00–{s['quiet_end']:02d}:00"),('M Meeting link',s['meeting_link'] or 'Not configured'),('Y Successful meeting link',s['success_link'] or 'Not configured'),('N Unsuccessful meeting link',s['unsuccessful_link'] or 'Not configured'),('F Model override',s['model'] or 'Provider default')]
        for i,(label,value)in enumerate(rows[:max(1,h-16)]):self.put(9+i,2,label,1);self.put(9+i,33,value)
        self.put(h-6,2,'V Verify provider  ·  B Export full memory backup  ·  O Restore backup',1)
        self.put(h-5,2,'Contact scope and opt-outs are enforced independently of editable prompts.',3)

    def chat(self):
        offset=0
        while True:
            self.refresh();self.drain();self.s.erase();h,w=self.s.getmaxyx()
            self.put(1,2,'ORACLE  /  Workspace conversation',1)
            self.put(3,2,'C Ask a question  ·  ↑/↓ Scroll  ·  Esc Back',5)
            entries=[]
            for m in self.state['chat']:
                entries.extend(textwrap.wrap(('You: ' if m['role']=='user' else 'Oracle: ')+m['text'],max(20,w-6)));entries.append('')
            if not entries:entries=['Ask “What happened in the previous run?” or “Who wants a meeting?”','Answers use your persistent relationship and activity records.']
            height=max(1,h-9);max_offset=max(0,len(entries)-height);offset=min(offset,max_offset)
            start=max(0,len(entries)-height-offset)
            for i,line in enumerate(entries[start:start+height]):self.put(5+i,2,line)
            self.put(h-3,2,'Thinking… You can leave this page while the answer is generated.' if self.pending else self.notice,5)
            self.s.refresh();key=self.s.getch()
            if key==27:return
            if key in (ord('c'),ord('C')):
                message=self.edit('Ask Oracle about your relationships, meetings or previous runs')
                if message:self.background('/api/chat',{'message':message},'Oracle answered. Open dashboard chat to read it.');offset=0
            if key==curses.KEY_UP:offset+=2
            if key==curses.KEY_DOWN:offset=max(0,offset-2)

    def profile(self,contact_id):
        offset=0
        while True:
            self.refresh();self.drain();detail=self.api.call('/api/contact/'+contact_id);c=detail['contact'];self.s.erase();h,w=self.s.getmaxyx()
            self.put(1,2,c['name']+'  /  '+c['phone'],1);self.put(2,2,c['company']+' · '+c['stage'])
            self.put(4,2,f"Scope: {'ACTIVE' if c['active'] else 'INACTIVE'} · Permission: {'yes' if c['consent'] else 'not recorded'} · Replies: {'agent' if c['auto_reply'] else 'human takeover'}",5)
            self.put(5,2,'A Access  ·  P Takeover  ·  E Edit  ·  S Stage  ·  N Memory  ·  M Meeting',1)
            self.put(6,2,'G Generate opener · W Write · J Drafts · O Opt-out · D Delete · Esc Back',1)
            lines=[]
            if c['notes']:lines+=textwrap.wrap('Notes: '+c['notes'],max(20,w-6))+['']
            for m in reversed(detail['memories'][:4]):lines+=textwrap.wrap(f"Memory ({m['kind']}): {m['content']}",max(20,w-6))
            for m in detail['messages']:lines+=textwrap.wrap(f"{m['created_at'][5:16]} {'THEM' if m['direction']=='in' else 'YOU'} [{m['status']}] {m['text']}",max(20,w-6))+['']
            if not lines:lines=['No conversation yet. Only approved scope can be monitored or messaged.']
            height=max(1,h-12);start=max(0,len(lines)-height-offset)
            for i,line in enumerate(lines[start:start+height]):self.put(8+i,2,line)
            self.put(h-3,2,self.notice,5);self.put(h-2,2,'↑/↓ scroll · B Meeting records · F Follow-up link · V Inspect/correct memories')
            self.s.refresh();key=self.s.getch()
            try:
                if key==27:return
                if key==curses.KEY_UP:offset+=2
                if key==curses.KEY_DOWN:offset=max(0,offset-2)
                if key in (ord('a'),ord('A')):
                    if c['active']:self.api.call('/api/contact/update',{'id':c['id'],'patch':{'active':False}})
                    elif self.confirm('Confirm this person gave permission for WhatsApp outreach and enable only this contact?'):
                        self.api.call('/api/contact/update',{'id':c['id'],'patch':{'consent':True,'active':True}})
                if key in (ord('p'),ord('P')):self.api.call('/api/contact/update',{'id':c['id'],'patch':{'auto_reply':not bool(c['auto_reply'])}})
                if key in (ord('o'),ord('O')):
                    if self.confirm('Mark this contact opted out and stop all outreach?'):self.api.call('/api/contact/update',{'id':c['id'],'patch':{'opted_out':True}})
                if key in (ord('s'),ord('S')):
                    stage=self.choose('Relationship stage',STAGES,STAGES.index(c['stage']))
                    if stage is not None:self.api.call('/api/contact/update',{'id':c['id'],'patch':{'stage':STAGES[stage]}})
                if key in (ord('e'),ord('E')):
                    patch={}
                    for field in ['name','company','role','source','notes','next_action','followup_at']:
                        value=self.edit(field.title(),c[field],multiline=field=='notes')
                        if value is None:break
                        patch[field]=value
                    else:self.api.call('/api/contact/update',{'id':c['id'],'patch':patch})
                if key in (ord('n'),ord('N')):
                    memory=self.edit('Relationship memory / correction',multiline=True)
                    if memory:self.api.call('/api/memory',{'contact_id':c['id'],'content':memory})
                if key in (ord('v'),ord('V')):
                    memories=detail['memories']
                    if not memories:self.notice='No relationship memories saved yet.'
                    else:
                        selected=self.choose('Relationship memories — source messages remain in the conversation',[m['kind']+'  '+m['content'][:70] for m in memories])
                        if selected is not None:
                            m=memories[selected];source=next((item for item in detail['messages']if item['id']==m['source_id']),None)
                            label='Memory correction'+(' · Source: '+source['text'][:70]if source else' · Operator-authored memory')
                            content=self.edit(label,m['content'],True)
                            if content is not None:
                                if content:self.api.call('/api/memory/update',{'id':m['id'],'content':content})
                                elif self.confirm('Delete this memory?','DELETE'):self.api.call('/api/memory/delete',{'id':m['id']})
                if key in (ord('m'),ord('M')):self.new_meeting(c)
                if key in (ord('b'),ord('B')):self.meetings(c['id'])
                if key in (ord('w'),ord('W')):
                    body=self.edit('Draft a message to '+c['name'],multiline=True)
                    if body:self.api.call('/api/draft',{'contact_id':c['id'],'text':body});self.review_jobs(c['id'])
                if key in (ord('g'),ord('G')):self.background('/api/draft/generate',{'contact_id':c['id']},'Opening draft ready. Press J to review the exact message.')
                if key in (ord('j'),ord('J')):self.review_jobs(c['id'])
                if key in (ord('f'),ord('F')):
                    choice=self.choose('Meeting follow-up link',['Successful meeting','Unsuccessful meeting','Meeting booking link'])
                    if choice is not None:
                        setting=['success_link','unsuccessful_link','meeting_link'][choice];link=self.state['settings'][setting]
                        if not link:raise RuntimeError('Configure this link on the settings page first.')
                        self.api.call('/api/draft',{'contact_id':c['id'],'text':link});self.review_jobs(c['id'])
                if key in (ord('d'),ord('D')) and self.confirm('Delete this contact and all their local messages, memories and meetings?','DELETE'):
                    self.api.call('/api/contact/delete',{'id':c['id']});return
            except Exception as error:self.notice=str(error)
            self.last_refresh=0

    def review_jobs(self,contact_id):
        jobs=self.api.call('/api/contact/'+contact_id)['jobs']
        if not jobs:self.notice='No drafts or unresolved messages for this contact.';return
        choice=self.choose('Drafts and send operations',[j['status'].upper()+'  '+(j['text'][:65] or j.get('error') or 'Generating response…') for j in jobs])
        if choice is None:return
        j=jobs[choice]
        if j['status']=='uncertain':
            resolved=self.choose('Check the conversation in WhatsApp before resolving. This never resends.', ['Mark sent — verified on WhatsApp','Cancel — no automatic retry'])
            if resolved is not None:self.api.call('/api/draft/resolve',{'id':j['id'],'status':['sent','cancelled'][resolved]})
        elif j['status']in ('draft','failed'):
            body=self.edit('Review exact message. Sender: '+str(self.state['whatsapp'].get('phone')),j['text'],multiline=True)
            if body is None:return
            send=self.confirm('Queue this exact message for the selected contact? Agent must be running; quiet hours apply.','SEND')
            self.api.call('/api/draft/review',{'id':j['id'],'text':body,'send':send});self.notice='Message approved and queued.' if send else 'Draft saved without sending.'
        elif j['status']in ('queued','ready') and self.confirm('Cancel this queued operation?'):self.api.call('/api/draft/cancel',{'id':j['id']})
        else:self.notice=j.get('error') or 'Operation is in progress.'

    def new_meeting(self,c):
        title=self.edit('Meeting title','Atlas walkthrough')
        if title is None:return
        starts=self.edit('Local meeting date/time (YYYY-MM-DD HH:MM)')
        if not starts:return
        date=dt.datetime.strptime(starts,'%Y-%m-%d %H:%M').astimezone().isoformat()
        self.api.call('/api/meeting',{'contact_id':c['id'],'title':title,'starts_at':date});self.notice='Local meeting saved. No external calendar invitation was sent.'

    def meetings(self,contact_id=None):
        self.refresh(True);meetings=[m for m in self.state['meetings'] if contact_id is None or m['contact_id']==contact_id]
        if not meetings:self.notice='No meeting records. Open a contact and press M to create one.';return
        chosen=self.choose('Meeting records',[f"{m['starts_at'][:16]}  {m['name']}  [{m['status']}]" for m in meetings])
        if chosen is None:return
        m=meetings[chosen];action=self.choose(m['title'],['Booked','Successful','Unsuccessful','Cancelled','Delete meeting record'])
        if action is None:return
        if action==4:
            if self.confirm('Delete this local meeting record?','DELETE'):self.api.call('/api/meeting/delete',{'id':m['id']})
        else:self.api.call('/api/meeting/update',{'id':m['id'],'status':['booked','successful','unsuccessful','cancelled'][action]})
        self.last_refresh=0

    def qr(self):
        self.background('/api/whatsapp/connect',{},'WhatsApp connection requested.')
        while True:
            self.refresh(True);self.drain();self.s.erase();h,w=self.s.getmaxyx();wa=self.state['whatsapp']
            self.put(1,2,'WHATSAPP  /  Link your account',1)
            self.put(3,2,'On your phone: WhatsApp → Linked devices → Link a device',5)
            if wa['status']=='connected':self.put(6,2,'Connected as '+wa['phone'],4);self.put(8,2,'Press Esc to return and activate selected contacts.');
            elif wa.get('qr_matrix'):
                matrix=wa['qr_matrix'];size=matrix['size'];data=matrix['data'];border=4;qrh=(size+border*2+1)//2
                if w<size+border*2+4 or h<qrh+8:self.put(6,2,f'Resize terminal to at least {size+border*2+5} × {qrh+9} to scan the QR.',5)
                else:
                    x=max(2,(w-size-border*2)//2)
                    def dark(row,col):return 0<=row<size and 0<=col<size and data[row*size+col]
                    for r in range(0,size+border*2,2):
                        for col in range(size+border*2):
                            top=dark(r-border,col-border);bottom=dark(r+1-border,col-border)
                            # White background; half-blocks draw black modules with a quiet border.
                            glyph='█' if top and bottom else '▀' if top else '▄' if bottom else ' '
                            try:self.s.addstr(5+r//2,x+col,glyph,curses.color_pair(7))
                            except curses.error:pass
            else:self.put(7,2,wa.get('error') or 'Waiting for the pairing QR…',5)
            self.put(h-2,2,'Esc Back · Account credentials remain in local private storage.');self.s.refresh()
            if self.s.getch()==27:return

    def import_file(self):
        value=self.edit('Path to CSV or JSON contact file (phone,name,company,role,source,notes)')
        if not value:return
        path=Path(value).expanduser()
        if path.stat().st_size>5000000:raise RuntimeError('Choose a file smaller than 5 MB.')
        data=path.read_text(encoding='utf-8-sig')
        if path.suffix.lower()=='.json':
            parsed=json.loads(data);rows=parsed if isinstance(parsed,list) else parsed.get('contacts',[])
            result=self.api.call('/api/import',{'contacts':rows})
        else:result=self.api.call('/api/import',{'csv':data})
        self.notice=f"Imported {result['added']}; duplicates {result['duplicates']}; invalid {len(result['errors'])}. All new contacts are inactive."
        if result['errors']:self.notice+=' First error: '+str(result['errors'][0])
        self.last_refresh=0

    def export(self,backup=False):
        value=self.edit('Save '+('full memory backup JSON' if backup else 'contacts CSV or JSON')+' to path',str(Path.home()/('oracle-leads-backup.json' if backup else 'oracle-leads-contacts.csv')))
        if not value:return
        path=Path(value).expanduser()
        if path.exists() and not self.confirm('File already exists. Overwrite it?','OVERWRITE'):return
        if backup:data=self.api.call('/api/export')
        elif path.suffix.lower()=='.csv':data=self.api.call('/api/export.csv')
        else:data={'contacts':self.state['contacts']}
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.fchmod(fd,0o600)
        with os.fdopen(fd,'w')as output:output.write(data if isinstance(data,str)else json.dumps(data,indent=2))
        self.notice='Saved '+str(path)

    def settings_key(self,key):
        key=chr(key).lower()if 0<=key<256 else '';s=self.state['settings']
        fields={'s':('system_prompt','Sales instructions',True),'k':('knowledge','Approved Atlas knowledge',True),'m':('meeting_link','Meeting booking link',False),'y':('success_link','Successful meeting follow-up link',False),'n':('unsuccessful_link','Unsuccessful meeting follow-up link',False),'f':('model','Model override (blank uses provider default)',False)}
        if key in fields:
            field,label,multi=fields[key];value=self.edit(label,s[field],multi)
            if value is not None:self.api.call('/api/settings',{field:value})
        elif key=='p':self.select_provider()
        elif key=='a':
            choice=self.choose('Incoming reply behaviour',['Review each generated reply before sending','Automatically reply to active, permitted contacts'],0 if s['reply_mode']=='review'else 1)
            if choice is not None:self.api.call('/api/settings',{'reply_mode':['review','auto'][choice]})
        elif key=='d':
            value=self.edit('Maximum sends per UTC day (1–500)',str(s['daily_limit']))
            if value is not None:self.api.call('/api/settings',{'daily_limit':int(value)})
        elif key=='t':
            value=self.edit('Quiet hours in local time, start-end (e.g. 20-9; 0-0 disables)',f"{s['quiet_start']}-{s['quiet_end']}")
            if value is not None:
                start,end=value.split('-');self.api.call('/api/settings',{'quiet_start':int(start),'quiet_end':int(end)})
        elif key=='v':self.background('/api/provider',message='Provider check:')
        elif key=='b':self.export(True)
        elif key=='o':
            path=self.edit('Restore backup into this EMPTY workspace. JSON backup path')
            if path and self.confirm('Restore relationship memory with all contacts inactive?','RESTORE'):self.api.call('/api/restore',{'path':str(Path(path).expanduser().resolve())});self.notice='Memory restored; outreach is paused and contacts are inactive.'
        self.last_refresh=0

    def drain(self):
        while True:
            try:self.notice=self.events.get_nowait();self.pending=False;self.last_refresh=0
            except queue.Empty:break

    def run(self):
        if not self.select_provider():return
        while True:
            try:self.refresh();self.drain()
            except Exception as error:self.notice=str(error)
            frame=self.frame()
            if frame and self.state:
                if self.page==0:self.dashboard(*frame)
                elif self.page in (1,2):self.contacts_page(*frame,whatsapp=self.page==1)
                else:self.settings_page(*frame)
            self.s.refresh();key=self.s.getch()
            try:
                if key in (ord('q'),ord('Q')):return
                if ord('1')<=key<=ord('4'):self.page=key-ord('1');self.row=0;self.search=''
                elif key==ord(' '):
                    paused=self.state['settings']['automation_paused'];self.api.call('/api/agent/start' if paused else '/api/agent/pause',{});self.notice='Agent paused.'if not paused else'Autonomous outreach started for enabled contacts.';self.last_refresh=0
                elif key in (ord('r'),ord('R')):self.last_refresh=0
                elif self.page==0:
                    if key in(ord('c'),ord('C')):self.chat()
                    if key in(ord('m'),ord('M')):self.meetings()
                    if key in(ord('h'),ord('H')):self.choose('Previous runs',[f"{r['started_at'][:19]}  {r['status']}  agent active {r['active_seconds']/3600:.2f}h"for r in self.state['runs']])
                elif self.page in(1,2):
                    if key==curses.KEY_UP:self.row=max(0,self.row-1)
                    if key==curses.KEY_DOWN:self.row=min(max(0,len(self.contacts(self.page==1))-1),self.row+1)
                    if key in(10,13)and self.contacts(self.page==1):self.profile(self.contacts(self.page==1)[self.row]['id'])
                    if key==ord('/'):
                        value=self.edit('Search name, company, phone or stage',self.search)
                        if value is not None:self.search=value;self.row=0
                    if self.page==2:
                        if key in(ord('i'),ord('I')):self.import_file()
                        if key in(ord('l'),ord('L')):
                            result=self.api.call('/api/import-legacy',{});self.notice=f"Imported {result['added']} contacts from Bismyth runs; originals unchanged. All new contacts are inactive.";self.last_refresh=0
                        if key in(ord('e'),ord('E')):self.export()
                    else:
                        if key in(ord('c'),ord('C')):self.qr()
                        if key in(ord('x'),ord('X')):self.api.call('/api/whatsapp/disconnect',{});self.last_refresh=0
                        if key in(ord('u'),ord('U'))and self.confirm('Unlink this WhatsApp session and deactivate all contacts?','UNLINK'):self.api.call('/api/whatsapp/unlink',{});self.last_refresh=0
                elif self.page==3:self.settings_key(key)
            except Exception as error:self.notice=str(error)


def main():
    parser=argparse.ArgumentParser(description='Oracle Leads — terminal outreach and relationship workspace')
    parser.add_argument('--provider',choices=['codex','selfhost'])
    parser.add_argument('--data-dir',type=Path,help='Separate persistent workspace directory')
    parser.add_argument('--connect',help='Connect to an existing loopback service instead of starting one')
    parser.add_argument('--service',action='store_true',help='Run the local service without the TUI')
    parser.add_argument('--version',action='version',version='Oracle Leads 0.3.0')
    parser.add_argument('--legacy-ui',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    env=dict(os.environ)
    if args.data_dir:env['ORACLE_LEADS_DATA']=str(args.data_dir.expanduser().resolve())
    command=[node_binary(),str(ROOT/'server/index.mjs'),'--port','0']
    if args.service:
        os.execve(command[0],command,env)
    child=None
    try:
        if args.connect:
            from urllib.parse import urlsplit
            parsed=urlsplit(args.connect)
            if parsed.scheme!='http'or parsed.hostname not in('127.0.0.1','localhost','::1'):raise RuntimeError('Connect only to a local HTTP service.')
            base=args.connect.rstrip('/')
        else:
            env['ORACLE_LEADS_PARENT_PID']=str(os.getpid())
            child=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
            ready,_,_=select.select([child.stdout],[],[],15)
            if not ready:raise RuntimeError('Local service startup timed out.')
            line=child.stdout.readline()
            if not line:
                raise RuntimeError('Local service could not start. Run npm install in '+str(ROOT)+' with Node 24, then retry.')
            info=json.loads(line);base='http://127.0.0.1:'+str(info['port'])
        if not sys.stdin.isatty() or not sys.stdout.isatty():raise RuntimeError('Open Oracle Leads in an interactive terminal.')
        data_dir=args.data_dir.expanduser() if args.data_dir else Path(env.get('ORACLE_LEADS_DATA',Path.home()/'.local/share/oracle-leads'))
        if args.legacy_ui:
            api=API(base,(data_dir/'.session-key').read_text().strip())
            curses.wrapper(lambda screen:TUI(screen,api,args.provider).run())
        else:
            binary=ROOT/'bin'/('oracle-leads-tui-'+sys.platform+'-'+platform.machine())
            if not binary.exists():
                raise RuntimeError('Native terminal frontend is missing. Build it with: python3 '+str(ROOT/'build_tui.py'))
            ui_env={**env,'ORACLE_LEADS_URL':base,'ORACLE_LEADS_KEY_FILE':str(data_dir/'.session-key')}
            if args.provider:ui_env['ORACLE_LEADS_PROVIDER']=args.provider
            else:ui_env.pop('ORACLE_LEADS_PROVIDER',None)
            result=subprocess.call([str(binary)],env=ui_env)
            if result: return result
    except(KeyboardInterrupt,SystemExit):pass
    except Exception as error:
        print('bismyth-leads: '+str(error),file=sys.stderr);return 1
    finally:
        if child:
            try:
                os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=10)
            except(ProcessLookupError,subprocess.TimeoutExpired):
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
    return 0

if __name__=='__main__':sys.exit(main())
