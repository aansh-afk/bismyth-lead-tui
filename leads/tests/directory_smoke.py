#!/usr/bin/env python3
"""Actual native directory with live search, safe source filters and previews."""
import json,os,sqlite3,subprocess,sys,tempfile,time
from pathlib import Path
import pexpect,pyte
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from terminal import API
ROOT=Path(__file__).resolve().parents[1]
NODE=str(Path.home()/'.nvm/versions/node/v24.13.0/bin/node')
def main():
 started=time.monotonic();clicks=0;captures={}
 with tempfile.TemporaryDirectory(prefix='oracle-directory-ui-')as directory:
  service=subprocess.Popen([NODE,str(ROOT/'tests/tui-fixture.mjs')],env={**os.environ,'ORACLE_LEADS_DATA':directory,'ORACLE_LEADS_FIXTURE':'1','ORACLE_LEADS_DIRECTORY_FIXTURE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  port=json.loads(service.stdout.readline())['port'];api=API(f'http://127.0.0.1:{port}',(Path(directory)/'.session-key').read_text().strip());command=os.environ.get('BISMYTH_TEST_COMMAND',sys.executable);args=[]if 'BISMYTH_TEST_COMMAND'in os.environ else[str(ROOT/'terminal.py')]
  child=pexpect.spawn(command,args+['--connect',f'http://127.0.0.1:{port}','--data-dir',directory,'--provider','codex'],env={**os.environ,'TERM':'xterm-256color'},dimensions=(44,160),encoding='utf-8')
  screen=pyte.Screen(160,44);stream=pyte.Stream(screen)
  def view():return '\n'.join(screen.display)
  def pump(duration=.2):
   end=time.monotonic()+duration
   while time.monotonic()<end:
    try:stream.feed(child.read_nonblocking(100000,timeout=.05))
    except pexpect.TIMEOUT:pass
  def wait(text):
   end=time.monotonic()+12
   while time.monotonic()<end:
    pump(.1)
    if text in view():return
   raise AssertionError('Missing '+text+'\n'+view())
  def click(text,last=False):
   nonlocal clicks
   pump();found=[(line.index(text)+len(text)//2,y)for y,line in enumerate(screen.display)if text in line];assert found,(text,view());x,y=found[-1 if last else 0];child.send(f'\x1b[<0;{x+1};{y+1}M\x1b[<0;{x+1};{y+1}m');clicks+=1;pump()
  def filter_click(text):
   nonlocal clicks
   pump();line_index=next(y for y,line in enumerate(screen.display)if all(word in line for word in ['All','Enabled','WhatsApp','Saved']));line=screen.display[line_index];x=line.index(text)+len(text)//2;child.send(f'\x1b[<0;{x+1};{line_index+1}M\x1b[<0;{x+1};{line_index+1}m');clicks+=1;pump()
  try:
   wait('Relationship overview');child.send('3');wait('41 results');click('Refresh WhatsApp');wait('Available WhatsApp contact updates checked');captures['all-sources']=view()
   click('Search name');child.send('Fixture 39');wait('1 results');wait('Call Thursday');wait('Met at the expo');captures['live-match']=view()
   click('Chat',True);wait('Please send the Atlas walkthrough');click('Memory',True);wait('Met at the expo');click('Overview',True);wait('Call Thursday')
   click('Clear');wait('41 results');child.send('/+1 (202) 555-0039');wait('1 results');wait('Call Thursday')
   child.setwinsize(24,80);screen.resize(24,80);pump(.5);wait('Fixture 39');wait('+12025550039');click('Memory',True);wait('Met at the expo');captures['compact-preview']=view()
   click('Chat',True);wait('Atlas walkthrough');click('Clear');wait('41 results');filter_click('WhatsApp');wait('3 results');filter_click('Saved');wait('40 results');filter_click('Enabled');wait('1 results');wait('Fixture 01');filter_click('All');wait('41 results')
   child.send('/q1234 no such person');wait('No matching contacts');assert 'Fixture 39' not in view();captures['no-match']=view();child.send('\x15');wait('41 results');child.send('Fixture 39');wait('1 results');child.send('\r');click('Actions');wait('Fixture 39 · relationship actions');child.send('\x1b');pump(.3)
   child.setwinsize(44,160);screen.resize(44,160);pump(.5);click('Clear');wait('41 results');child.send('\x1b[F');wait('WhatsApp Person');child.send('\x1b[H');wait('Fixture 01')
   first=next(c for c in api.call('/api/state')['contacts']if c['phone']=='+12025550001');api.call('/api/contact/update',{'id':first['id'],'patch':{'name':'Zed Fixture 01'}});wait('╭ Zed Fixture 01');captures['selection-after-refresh']=view()
   child.send('q');child.expect(pexpect.EOF,timeout=15);service.terminate();service.wait(timeout=10)
   conn=sqlite3.connect(Path(directory)/'oracle-leads.sqlite');assert conn.execute('select count(*) from contacts').fetchone()[0]==41;assert conn.execute('select count(*) from contacts where active=1').fetchone()[0]==1;assert conn.execute("select count(*) from messages where direction='out'").fetchone()[0]==0;conn.close()
   (ROOT/'docs/directory-terminal-screens.txt').write_text('\n\n'.join('=== SYNTHETIC '+name+' ===\n'+'\n'.join(l.rstrip()for l in value.splitlines())for name,value in captures.items())+'\n')
   print(f'PASS: {clicks} SGR clicks; live name/formatted-phone search, source and enabled filters, result counts, preview/chat/memory tabs, 160x44 and 80x24, clear/no-match states, search consumes shortcuts, Home/End, 41 contacts and no permission changes/outbound messages; {time.monotonic()-started:.2f}s.')
  finally:
   if child.isalive():child.terminate(force=True)
   if service.poll()is None:service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
