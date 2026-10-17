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
  service=subprocess.Popen([NODE,str(ROOT/'tests/tui-fixture.mjs')],env={**os.environ,'ORACLE_LEADS_DATA':directory,'ORACLE_LEADS_FIXTURE':'1','ORACLE_LEADS_PAIRING_FIXTURE':'1'},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
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
   wait('Relationship overview');child.send('2');wait('Enter phone number');click('Connect / QR');wait('Enter phone number instead');click('Enter phone number instead');wait('WhatsApp number');child.send('+12025550199');click('Get code');wait('ABCD–1234');wait('Link with phone number instead. Enter this code there.');wait('only after WhatsApp confirms');
   child.setwinsize(24,80);screen.resize(24,80);pump(.5);wait('ABCD–1234');click('Use QR');wait('Enter phone number instead');assert 'ABCD–1234' not in view();click('Back');wait('SCOPED INBOX');child.send('f');wait('WhatsApp number');child.send('+12025550199');child.send('\r');wait('ABCD–1234');click('Back');wait('SCOPED INBOX');click('Disconnect');wait('WhatsApp disconnected');child.send('q');child.expect(pexpect.EOF,timeout=10)
   service.terminate();service.wait(timeout=10);conn=sqlite3.connect(Path(directory)/'oracle-leads.sqlite');assert conn.execute('select count(*) from contacts').fetchone()[0]==0;assert conn.execute('select count(*) from messages').fetchone()[0]==0;assert not conn.execute("select 1 from activity where detail like '%ABCD1234%'").fetchone();conn.close()
   print(f'PASS: {clicks} SGR mouse clicks; QR-to-phone fallback, toolbar phone pairing, code/instructions at 128x40 and 80x24, keyboard submit, return to QR, disconnect; no contacts or messages; {time.monotonic()-started:.2f}s.')
  finally:
   if child.isalive():child.terminate(force=True)
   if service.poll()is None:service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
