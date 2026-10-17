#!/usr/bin/env python3
"""Exercise the real curses app and HTTP service with synthetic transport only."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import sys
import pexpect
import pyte
ROOT=Path(__file__).resolve().parents[1]
NODE=str(Path.home()/'.nvm/versions/node/v24.13.0/bin/node')

def main():
    captures={}
    with tempfile.TemporaryDirectory(prefix='oracle-leads-terminal-')as directory:
        data=Path(directory);csv=data/'contacts.csv';csv.write_text('name,phone,company\nFixture One,+12025550101,Synthetic Brokerage\nFixture Two,+12025550102,Synthetic Brokerage\n')
        def start_service():
            env={**os.environ,'ORACLE_LEADS_DATA':directory,'ORACLE_LEADS_FIXTURE':'1'}
            service=subprocess.Popen([NODE,str(ROOT/'tests/tui-fixture.mjs')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            port=json.loads(service.stdout.readline())['port'];return service,port
        service,port=start_service()
        child=None
        try:
            screen=pyte.Screen(128,40);stream=pyte.Stream(screen)
            def launch():
                return pexpect.spawn(sys.executable,[str(ROOT/'terminal.py'),'--connect',f'http://127.0.0.1:{port}','--data-dir',directory,'--provider','codex'],env={**os.environ,'TERM':'xterm-256color'},dimensions=(40,128),encoding='utf-8',timeout=15)
            child=launch()
            def view():return '\n'.join(screen.display)
            def wait(expected,timeout=12):
                deadline=time.monotonic()+timeout
                while time.monotonic()<deadline:
                    try:stream.feed(child.read_nonblocking(50000,timeout=.15))
                    except pexpect.TIMEOUT:pass
                    if expected in view():return
                raise AssertionError('Missing '+expected+'\n'+view())
            def send(value):child.send(value)
            def line(value):child.sendline(value)
            wait('RECENT ACTIVITY');captures['dashboard-empty']=view()
            send('3');wait('Your relationship workspace is empty')
            send('i');wait('Path to CSV');line(str(csv));wait('Fixture One')
            send('\r');wait('Scope: INACTIVE')
            send('a');wait('Type YES');line('YES');wait('Scope: ACTIVE')
            send('n');wait('Relationship memory / correction');send('Persistent fixture memory');send('\x07');wait('Persistent fixture memory')
            send('m');wait('Meeting title');send('\x15');line('Fixture demo');wait('Local meeting date/time');line('2030-01-01 10:00');wait('Local meeting saved')
            captures['relationship']=view()
            send('\x1b');time.sleep(.5);send('1');wait('RECENT ACTIVITY')
            send('c');wait('Workspace conversation');send('c');wait('Ask Oracle');line('What happened in the previous run?');wait('Fixture summary: 2 contacts and 1 booked meetings.')
            captures['dashboard-chat']=view()
            send('\x1b');time.sleep(.5);send('4');wait('WORKSPACE SETTINGS');captures['settings']=view()
            send('y');wait('Successful meeting follow-up link');line('https://example.com/fixture-success');wait('example.com/fixture-success')
            send('3');wait('CONTACTS  2 relationships');send('e');wait('Save contacts');send('\x15');line(str(data/'export.csv'));wait('Saved '+str(data/'export.csv'));assert 'Fixture One'in(data/'export.csv').read_text()
            send('\r');wait('Scope: ACTIVE');send('w');wait('Draft a message');send('Synthetic reviewed message');send('\x07');wait('Drafts and send operations');send('\r');wait('Review exact message');send('\x07');wait('Type SEND');line('SEND');wait('Message approved and queued.')
            send('\x1b');time.sleep(.5);send(' ');wait('AGENT RUNNING')
            time.sleep(2);send('1');wait('Sent 1');captures['dashboard-sent']=view()
            send('m');wait('Meeting records');send('\r');wait('Delete meeting record');send('\x1b');time.sleep(.4)
            send('q');child.expect(pexpect.EOF,timeout=10);assert child.exitstatus in(None,0)
            service.terminate();service.wait(timeout=10)
            service,port=start_service();screen.reset();child=launch();wait('RECENT ACTIVITY');wait('PAUSED')
            send('3');wait('Fixture One');send('\r');wait('Persistent fixture memory');wait('Synthetic reviewed message');captures['relationship-after-restart']=view()
            send('\x1b');time.sleep(.4);send('1');wait('RECENT ACTIVITY');send('m');wait('Meeting records');send('\r');wait('Delete meeting record')
            send('5');wait('Type DELETE');line('DELETE');time.sleep(.4)
            send('q');child.expect(pexpect.EOF,timeout=10)
            service.terminate();service.wait(timeout=10)
            conn=sqlite3.connect(data/'oracle-leads.sqlite')
            assert conn.execute('select count(*) from meetings').fetchone()[0]==0
            assert conn.execute("select count(*) from messages where direction='out' and status='sent'").fetchone()[0]==1
            assert conn.execute('select count(*) from memories').fetchone()[0]==1
            conn.close()
            artifact=ROOT/'docs/terminal-smoke-screens.txt';artifact.parent.mkdir(exist_ok=True)
            artifact.write_text('\n\n'.join('=== SYNTHETIC '+name+' ===\n'+'\n'.join(line.rstrip() for line in content.splitlines()) for name,content in captures.items()).rstrip()+'\n')
            print('PASS: import, explicit activation, source-independent memory, meeting creation/deletion, dashboard chat, settings, export, exact send review, one synthetic send, restart persistence and paused restart.')
        finally:
            if child and child.isalive():child.terminate(force=True)
            if service.poll()is None:service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
