#!/usr/bin/env python3
"""Real native mouse input and HTTP service; synthetic pairing only."""
import json, os, sqlite3, subprocess, sys, tempfile, time
from pathlib import Path
import pexpect, pyte
ROOT=Path(__file__).resolve().parents[1]
NODE=str(Path.home()/'.nvm/versions/node/v24.13.0/bin/node')
def main():
 started=time.monotonic();clicks=0
 with tempfile.TemporaryDirectory(prefix='oracle-phone-ui-')as directory:
  service=subprocess.Popen([NODE,str(ROOT/'tests/tui-fixture.mjs')],env={**os.environ,'ORACLE_LEADS_DATA':directory,'ORACLE_LEADS_FIXTURE':'1','ORACLE_LEADS_RELOGIN_FIXTURE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  port=json.loads(service.stdout.readline())['port'];command=os.environ.get('BISMYTH_TEST_COMMAND',sys.executable);args=[]if 'BISMYTH_TEST_COMMAND'in os.environ else[str(ROOT/'terminal.py')]
  child=pexpect.spawn(command,args+['--connect',f'http://127.0.0.1:{port}','--data-dir',directory,'--provider','codex'],env={**os.environ,'TERM':'xterm-256color'},dimensions=(40,128),encoding='utf-8')
  screen=pyte.Screen(128,40);stream=pyte.Stream(screen)
  def view():return '\n'.join(screen.display)
  def pump(duration=.25):
   end=time.monotonic()+duration
   while time.monotonic()<end:
    try:stream.feed(child.read_nonblocking(100000,timeout=.05))
    except pexpect.TIMEOUT:pass
  def wait(text):
   end=time.monotonic()+10
   while time.monotonic()<end:
    pump(.1)
    if text in view():return
   raise AssertionError('Missing '+text+'\n'+view())
  def click(text):
   nonlocal clicks
   pump();found=[(line.index(text)+len(text)//2,y)for y,line in enumerate(screen.display)if text in line];assert found,(text,view());x,y=found[0];child.send(f'\x1b[<0;{x+1};{y+1}M\x1b[<0;{x+1};{y+1}m');clicks+=1;pump()
  try:
   wait('Relink your WhatsApp number');wait('+12025550199');click('Later');wait('Relationship overview');child.send('2');wait('Relogin');click('Relogin');wait('Relink your WhatsApp number');click('Get a pairing code');wait('ABCD–1234');wait('Relink +12025550199');wait('Press Start Agent after linking.');
   child.setwinsize(24,80);screen.resize(24,80);pump(.5);wait('ABCD–1234');wait('Relink +12025550199');click('Back');wait('SCOPED INBOX');click('Relogin');wait('Relink your WhatsApp number');click('Scan QR');wait('Relink +12025550199');click('Back');wait('SCOPED INBOX');child.send('1');wait('Relationship overview');pump(1.5);assert 'Relink your WhatsApp number' not in view();child.send('q');child.expect(pexpect.EOF,timeout=10)
   service.terminate();service.wait(timeout=10);conn=sqlite3.connect(Path(directory)/'oracle-leads.sqlite');assert conn.execute('select count(*) from contacts').fetchone()[0]==0;assert conn.execute('select count(*) from messages').fetchone()[0]==0;assert not conn.execute("select 1 from activity where detail like '%ABCD1234%'").fetchone();conn.close()
   print(f'PASS: {clicks} SGR mouse clicks; expiry prompt on Dashboard, Later dismissal, persistent Relogin, same-number phone code and QR, recovery instructions at 128x40 and 80x24; no contacts or messages; {time.monotonic()-started:.2f}s.')
  finally:
   if child.isalive():child.terminate(force=True)
   if service.poll()is None:service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
