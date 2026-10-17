#!/usr/bin/env python3
"""Installed command, provider picker and real local service; no WhatsApp connection."""
import os
from pathlib import Path
import tempfile
import time
import pexpect
import pyte

def main():
 with tempfile.TemporaryDirectory(prefix='oracle-leads-installed-')as directory:
  child=pexpect.spawn(os.environ.get('BISMYTH_TEST_COMMAND',str(Path.home()/'.local/bin/bismyth-leads')),['--data-dir',directory],env={**os.environ,'TERM':'xterm-256color'},dimensions=(32,110),encoding='utf-8',timeout=15)
  screen=pyte.Screen(110,32);stream=pyte.Stream(screen)
  def wait(expected):
   end=time.monotonic()+15
   while time.monotonic()<end:
    try:stream.feed(child.read_nonblocking(40000,timeout=.15))
    except pexpect.TIMEOUT:pass
    if expected in '\n'.join(screen.display):return
   raise AssertionError('Missing '+expected+'\n'+'\n'.join(screen.display))
  try:
   wait('Choose your model');child.send('1');wait('Relationship overview');wait('Start agent');child.send('2');wait('No account paired');child.send('3');wait('Your relationship workspace is empty');child.send('4');wait('Workspace settings');child.send('v');wait('ChatGPT subscription connected.');child.setwinsize(24,80);time.sleep(.5);child.send('r');wait('Workspace settings');child.send('q');child.expect(pexpect.EOF,timeout=15)
   assert (Path(directory)/'oracle-leads.sqlite').exists()
   assert list((Path(directory)/'backups').glob('*.json'))
   assert not (Path(directory)/'service.lock').exists()
   print('PASS: installed command, startup provider picker, four real TUI pages, live ChatGPT login status, 80x24 resize, graceful service shutdown and automatic backup.')
  finally:
   if child.isalive():child.terminate(force=True)
if __name__=='__main__':main()
