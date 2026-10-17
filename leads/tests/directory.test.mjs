import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Store} from "../server/store.mjs";
import {loadSavedDirectory} from "../server/import.mjs";
function fixture(t){const dir=mkdtempSync(join(tmpdir(),"oracle-directory-"));const store=new Store(join(dir,"test.sqlite"));t.after(()=>{store.db.close();rmSync(dir,{recursive:true,force:true});});return store;}
test("saved directory imports once, deduplicates and cannot resurrect a deleted contact on restart",async t=>{
 const s=fixture(t);let calls=0;const load=async()=>{calls++;return [{phone:"+12025550101",name:"Saved One",active:true,consent:true}];};
 await loadSavedDirectory(s,load);let c=s.state().contacts[0];assert.equal(c.active,0);assert.equal(c.consent,0);s.run("DELETE FROM contacts WHERE id=?",c.id);await loadSavedDirectory(s,load);assert.equal(calls,1);assert.equal(s.state().contacts.length,0);
});
test("a failed saved-contact scan reports an error and can retry without a seeded marker",async t=>{
 const s=fixture(t);await loadSavedDirectory(s,async()=>{throw new Error('broken fixture');});assert.equal(s.state().directory.legacy.status,'error');assert.equal(s.get('directory_legacy_loaded'),null);await loadSavedDirectory(s,async()=>[]);assert.equal(s.get('directory_legacy_loaded'),true);
});
test("WhatsApp directory import is inactive and preserves existing consent, names and opt-outs",t=>{
 const s=fixture(t);s.importContacts([{phone:"+12025550101",name:"Operator name",source:"Saved lead"}]);const c=s.state().contacts[0];s.patchContact(c.id,{opted_out:true},null);
 s.syncContactDirectory([{phone:c.phone,name:"Phone name"},{phone:"+12025550102",name:"Phone Two",active:true,consent:true}]);
 const rows=s.state().contacts;assert.equal(rows.length,2);for(const c of rows){assert.equal(c.whatsapp_known,true);assert.equal(c.active,0);assert.equal(c.consent,0);}
 const original=s.contact(c.id);assert.equal(original.name,"Operator name");assert.equal(original.opted_out,1);assert.equal(original.source,"Saved lead");
});
test("later WhatsApp metadata can replace a phone placeholder without granting access",t=>{
 const s=fixture(t);s.syncContactDirectory([{phone:"+12025550101",name:"+12025550101"}]);s.syncContactDirectory([{phone:"+12025550101",name:"Shared Name"}]);const c=s.state().contacts[0];assert.equal(c.name,"Shared Name");assert.equal(c.active,0);assert.equal(c.consent,0);assert.equal(s.state().directory.whatsapp.known,1);
});
test("deleted-directory suppression prevents reappearance from WhatsApp events",t=>{
 const s=fixture(t);s.set("directory_deleted:+12025550101",true);s.syncContactDirectory([{phone:"+12025550101",name:"Deleted"}]);assert.equal(s.state().contacts.length,0);
});
test("the directory state does not silently hide contacts after 10,000 records",t=>{
 const s=fixture(t);const q=s.db.prepare("INSERT INTO contacts(id,phone,name,created_at,updated_at) VALUES(?,?,?,?,?)");s.db.exec('BEGIN');for(let i=0;i<10001;i++)q.run(String(i),'+1202'+String(i).padStart(7,'0'),'Contact '+i,'2030-01-01','2030-01-01');s.db.exec('COMMIT');assert.equal(s.state().contacts.length,10001);
});
