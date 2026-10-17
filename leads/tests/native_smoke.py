#!/usr/bin/env python3
"""Exercise native mouse/keyboard paths with isolated synthetic relationships."""
import json, os, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
import pexpect, pyte
ROOT=Path(__file__).resolve().parents[1]
NODE=str(Path.home()/'.nvm/versions/node/v24.13.0/bin/node')
def main():
 started=time.monotonic(); captures={}; clicks=0
 with tempfile.TemporaryDirectory(prefix='oracle-native-') as directory:
  data=Path(directory); csv=data/'contacts.csv';csv.write_text('name,phone,company\n'+''.join(f'Fixture {i:02},+1202555{i:04},Synthetic Brokerage\n' for i in range(1,41)))
  service=subprocess.Popen([NODE,str(ROOT/'tests/tui-fixture.mjs')],env={**os.environ,'ORACLE_LEADS_DATA':directory,'ORACLE_LEADS_FIXTURE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  port=json.loads(service.stdout.readline())['port']; child=None
  try:
   command=os.environ.get('BISMYTH_TEST_COMMAND',sys.executable)
   args=[] if 'BISMYTH_TEST_COMMAND' in os.environ else [str(ROOT/'terminal.py')]
   child=pexpect.spawn(command,args+['--connect',f'http://127.0.0.1:{port}','--data-dir',directory,'--provider','codex'],env={**os.environ,'TERM':'xterm-256color'},dimensions=(44,160),encoding='utf-8',timeout=15)
   screen=pyte.Screen(160,44);stream=pyte.Stream(screen)
   def view():return '\n'.join(screen.display)
   def pump(duration=.25):
    end=time.monotonic()+duration
    while time.monotonic()<end:
     try:stream.feed(child.read_nonblocking(100000,timeout=.05))
     except pexpect.TIMEOUT:pass
   def wait(text,timeout=12):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
     pump(.1)
     if text in view():return
    raise AssertionError('Missing '+text+'\n'+view())
   def click(text,occurrence=0):
    nonlocal clicks
    pump();found=[(line.index(text)+max(0,len(text)//2),y) for y,line in enumerate(screen.display) if text in line]
    assert found and len(found)>occurrence,(text,view())
    x,y=found[occurrence];child.send(f'\x1b[<0;{x+1};{y+1}M\x1b[<0;{x+1};{y+1}m');clicks+=1;pump()
   def esc():child.send('\x1b');pump(.35)
   def save():click('Save',-1)
   wait('RECENT ACTIVITY');captures['dashboard']=view()
   click('Contacts');wait('Your relationship workspace is empty')
   click('Import');wait('Local file path');child.send(str(csv));save();wait('Fixture 01')
   click('Fixture 02');click('Actions',-1);wait('Fixture 02 · relationship actions');esc()
   # Wheel selects a different row in the contact list.
   child.send('\x1b[<65;35;15M');pump();click('Actions',-1);wait('Fixture 03 · relationship actions');esc()
   click('Fixture 01');child.send('a');wait('Enable this contact');click('Cancel');wait('People & memory')
   child.send('a');wait('Enable this contact');click('Confirm',1);wait('Contact enabled')
   child.send('n');wait('Add relationship memory');child.send('\x1b[200~Permanent memory\nSecond line\x1b[201~');save();wait('Permanent memory');captures['contacts']=view()
   # Multi-field mouse focus and insertion at the clicked caret.
   click('Actions',-1);click('Edit relationship details');wait('Edit relationship');click('Company',-1);child.send('\x15Mouse Brokerage');save();wait('Mouse Brokerage')
   click('Actions',-1);click('Create a local meeting');wait('Create a local meeting');child.send('\x15Fixture demo\t2030-01-01T10:00:00+05:30');save();wait('Local meeting saved')
   click('Dashboard');click('What happened');child.send('What happened last run?');click('Send');wait('Fixture summary: 40 contacts and 1 booked meetings.');captures['chat']=view()
   click('Contacts');click('Fixture 02');child.send('a');wait('Enable this contact');click('Confirm',1);wait('Contact enabled')
   child.send('2');wait('SCOPED INBOX');click('Fixture 02')
   # One Start automatically introduces the enabled contact without a review path.
   click('Start agent');wait('Pause agent');wait('Autonomous outreach started');time.sleep(1.8)
   click('Activity');wait('Automatic activity');wait('SENT');esc()
   conn=sqlite3.connect(data/'oracle-leads.sqlite');assert conn.execute("select count(*) from messages where direction='out' and status='sent'").fetchone()[0]==1;assert conn.execute("select count(*) from jobs where status='draft'").fetchone()[0]==0;conn.close()
   # A new inbound is answered automatically, using that relationship's saved memory.
   sys.path.insert(0,str(ROOT));from terminal import API
   api=API(f'http://127.0.0.1:{port}',(data/'.session-key').read_text().strip())
   state=api.call('/api/state');contact=next(c for c in state['contacts']if c['phone']=='+12025550002')
   api.call('/api/fixture/incoming',{'contact_id':contact['id'],'text':'Can we arrange an Atlas walkthrough?'})
   time.sleep(1.8);click('Activity');wait('Automatic activity');wait('SENT');esc()
   api.call('/api/fixture/incoming',{'contact_id':contact['id'],'text':'Can we arrange an Atlas walkthrough?'})
   time.sleep(1.8);click('Activity');wait('Automatic activity');wait('SENT');esc();captures['autonomous-whatsapp']=view()
   click('Pause agent');wait('Start agent')
   click('Settings');wait('AGENT & WORKSPACE');click('Daily send limit');wait('Daily send limit');child.send('\x1525');save();wait('Setting saved.');click('Response timing');wait('Response timing');child.send('\x150\t0');save();wait('Response timing saved.');captures['settings']=view()
   child.setwinsize(24,80);screen.resize(24,80);pump(.6);wait('Workspace settings');captures['compact']=view()
   child.setwinsize(10,40);screen.resize(10,40);pump(.5);wait('Oracle Leads needs at least')
   child.setwinsize(44,160);screen.resize(44,160);pump(.5);child.send('q');child.expect(pexpect.EOF,timeout=15)
   service.terminate();service.wait(timeout=10)
   conn=sqlite3.connect(data/'oracle-leads.sqlite');assert conn.execute('select count(*) from contacts').fetchone()[0]==40;assert conn.execute('select count(*) from meetings').fetchone()[0]==1;assert conn.execute('select count(*) from memories').fetchone()[0]>=2;assert conn.execute("select count(*) from messages where direction='out' and status='sent'").fetchone()[0]==3;assert conn.execute("select count(*) from contacts where company='Mouse Brokerage'").fetchone()[0]==1;conn.close()
   target=ROOT/'docs/native-terminal-screens.txt';target.write_text('\n\n'.join('=== SYNTHETIC '+name+' ===\n'+'\n'.join(l.rstrip() for l in content.splitlines()) for name,content in captures.items())+'\n')
   print(f'PASS: {clicks} real SGR mouse clicks, wheel selection, paste, field editing, permission cancellation/activation, memory, meeting, inline chat, autonomous Start, introduction and context-aware reply, no approval drafts, three synthetic sends including repeated inbound text, settings, 160x44/80x24/40x10 resize; {time.monotonic()-started:.2f}s.')
  finally:
   if child and child.isalive():child.terminate(force=True)
   if service.poll() is None:service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
