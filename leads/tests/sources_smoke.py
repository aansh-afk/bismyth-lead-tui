#!/usr/bin/env python3
"""Native Sources page with the real service, synthetic Firecrawl responses only."""
import json,os,sqlite3,subprocess,sys,tempfile,time
from pathlib import Path
import pexpect,pyte
ROOT=Path(__file__).resolve().parents[1];NODE=str(Path.home()/'.nvm/versions/node/v24.13.0/bin/node')
def main():
 started=time.monotonic();clicks=0;key='fc-synthetic-ui-key-only'
 with tempfile.TemporaryDirectory(prefix='oracle-sources-ui-')as directory:
  service=subprocess.Popen([NODE,str(ROOT/'tests/tui-fixture.mjs')],env={**os.environ,'ORACLE_LEADS_FIXTURE':'1','ORACLE_LEADS_SOURCES_FIXTURE':'1','ORACLE_LEADS_DATA':directory},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);child=None
  try:
   port=json.loads(service.stdout.readline())['port'];command=os.environ.get('BISMYTH_TEST_COMMAND',sys.executable);args=[]if 'BISMYTH_TEST_COMMAND'in os.environ else[str(ROOT/'terminal.py')]
   child=pexpect.spawn(command,args+['--connect',f'http://127.0.0.1:{port}','--data-dir',directory,'--provider','codex'],env={**os.environ,'TERM':'xterm-256color'},dimensions=(44,160),encoding='utf-8');screen=pyte.Screen(160,44);stream=pyte.Stream(screen)
   def view():return '\n'.join(screen.display)
   def pump(seconds=.2):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
     try:stream.feed(child.read_nonblocking(100000,timeout=.05))
     except pexpect.TIMEOUT:pass
   def wait(text):
    end=time.monotonic()+12
    while time.monotonic()<end:
     pump(.1)
     if text in view():return
    raise AssertionError('Missing '+text+'\n'+view())
   def click(text,occurrence=0):
    nonlocal clicks
    pump();positions=[(line.index(text)+len(text)//2,y)for y,line in enumerate(screen.display)if text in line];assert positions,(text,view());x,y=positions[occurrence];child.send(f'\x1b[<0;{x+1};{y+1}M\x1b[<0;{x+1};{y+1}m');clicks+=1;pump()
   def esc():child.send('\x1b');pump(.3)
   wait('Relationship overview');click('Sources');wait('Prospect sources');wait('needs API key');click('Configure');wait('Firecrawl API key');child.send(key);pump();assert key not in view();assert '********'in view();click('Save key');wait('key configuration saved');click('Credits');wait('credits 1000');click('Search web');wait('Search query');child.send('\x15Synthetic brokerages');click('Search',-1);wait('Fixture Brokerage')
   # Scrape an explicit URL while another result is selected; the new source must be selected automatically.
   click('Scrape URL');wait('Inspect a website page');child.send('https://fixture.example.test/contact');click('Scrape',-1);wait('Source saved · added 1');wait('Saved to Contacts from this source: 1');wait('Fixture Owner');wait('Company: Fixture Brokerage');dbcheck=sqlite3.connect(Path(directory)/'oracle-leads.sqlite');assert dbcheck.execute('select count(*) from contacts').fetchone()[0]==1;assert dbcheck.execute('select active,consent from contacts').fetchone()==(0,0);dbcheck.close();click('Page contacts');wait('Sourced contacts');click('› Fixture Owner');wait('Contact & company relationship');wait('Role: Owner');wait('Company: Fixture Brokerage');click('Open saved relationship');wait('SCRAPED FROM');wait('https://fixture.example.test/contact');child.send('5');wait('Prospect sources')
   click('Collect');wait('Collect contacts from saved results');click('  Collect contacts  ');wait('Contact collection started');click('Runs');wait('Research runs');click('batch  ',-1);wait('Research progress');click('Refresh research status');wait('Crawl progress checked');wait('3 contacts');click('Companies');wait('Companies from sources');click('Fixture Brokerage · 3 contacts');wait('Sourced contacts');wait('Fixture Partner');wait('Fixture Analyst');esc()
   click('Manage');wait('Manage sources');click('Reprocess saved directories');wait('Reprocessed 0 pages locally');click('Manage');click('Import all saved phone contacts');wait('Import sourced phone contacts?');click('Confirm');wait('Imported 1');click('Manage');click('Export all sourced contacts as JSON');wait('Export sourced contacts');child.send('\x15'+directory+'/research.json');child.send('\x13');wait('Saved '+directory+'/research.json');export=json.loads(Path(directory,'research.json').read_text());assert len(export['contacts'])==3;assert any(c['name']=='Fixture Analyst' and not c['phone']for c in export['contacts']);assert all(c['company']=='Fixture Brokerage'for c in export['contacts'])
   click('Crawl site');wait('Crawl a whole website');child.send('https://fixture.example.test\t\x152');click('Start crawl');wait('Website crawl started');click('Runs');wait('Research runs');click('crawl  ',-1);wait('Research progress');click('Refresh research status');wait('Crawl progress checked');wait('2 sources');wide=view()
   # Cancel once to verify deletion needs an explicit choice, then remove just one page.
   click('Actions');click('Delete this source');wait('Delete saved sources?');click('Cancel');assert sqlite3.connect(Path(directory)/'oracle-leads.sqlite').execute('select count(*) from source_pages').fetchone()[0]==2
   click('Actions');click('Delete this source');click('Confirm');wait('Sources deleted');wait('1 sources')
   child.setwinsize(24,80);screen.resize(24,80);pump(.7);wait('Prospect sources');wait('5 Sources');wait('SAVED SOURCES');wait('Manage');wait('Configure');child.send('4');wait('Workspace settings');child.send('5');wait('Prospect sources');click('Manage');wait('Manage sources');click('Delete all saved sources');wait('Delete saved sources?');click('Confirm');wait('Sources deleted');wait('0 sources');child.send('q');child.expect(pexpect.EOF,timeout=10)
   service.terminate();service.wait(timeout=10);db=sqlite3.connect(Path(directory)/'oracle-leads.sqlite');assert db.execute('select count(*) from contacts').fetchone()[0]==2;assert db.execute("select active,consent,company,role from contacts where name='Fixture Owner'").fetchone()==(0,0,'Fixture Brokerage','Owner');assert db.execute('select count(*) from source_pages').fetchone()[0]==0;assert db.execute('select count(*) from contact_sources').fetchone()[0]==2;assert db.execute("select status,completed from source_runs where kind='crawl'").fetchone()==('completed',2);assert db.execute('select count(*) from messages').fetchone()[0]==0;db.close();assert (Path(directory)/'firecrawl.key').stat().st_mode&0o777==0o600
   (ROOT/'docs/sources-terminal-screens.txt').write_text('=== SYNTHETIC SOURCES 160x44 ===\n'+'\n'.join(x.rstrip()for x in wide.splitlines())+'\n')
   print(f'PASS: {clicks} mouse clicks; fifth-page navigation, masked key, automatic source-linked scrape/import, company relationships, inactive imports, bounded batch collection, email-only export, crawl progress, confirmed single/all deletion and 160x44/80x24 layouts; zero messages; {time.monotonic()-started:.2f}s.')
  finally:
   if child and child.isalive():child.terminate(force=True)
   if service.poll()is None:service.terminate();service.wait(timeout=10)
if __name__=='__main__':main()
