import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {wallAvatarFixture,must} from './fixtures/wall-avatar.js'
import {reviewRoot} from '../scripts/aula-local.mjs'
const f=await wallAvatarFixture(),checks=[],pass=name=>{checks.push(name);console.log('PASS '+name)}
try{
 const snapshot=await must(f.wall.rpc('wall_snapshot'))
 const ordered=await must(f.client.from('household_people').select('id').eq('household_id',f.hid).order('sort_order').order('name').order('id'));assert.deepEqual(snapshot.people.map(p=>p.id),ordered.map(p=>p.id));pass('Wall person order matches web/mobile, preserving stack and overflow identity')
 assert.deepEqual(Object.keys(snapshot).sort(),['access','device','household','items','people','rewards']);
 for(const p of snapshot.people)assert.deepEqual(Object.keys(p).sort(),['avatar_path','avatar_url','color','household_id','id','is_active','name','reward_enabled','role'])
 assert.equal(snapshot.people.find(p=>p.id===f.ida.id).avatar_path,f.photoPath);assert.equal(snapshot.people.find(p=>p.id===f.carl.id).avatar_url,f.carl.avatar_url);pass('Exact avatar projection includes existing URL and private upload path')
 const json=JSON.stringify(snapshot);for(const secret of ['PRIVATE_','source_key','aulaSourceKey','aulaFindingId','encrypted_session','identity_label','feed_url'])assert.ok(!json.includes(secret),secret);pass('No account, feed, source payload or Aula integration metadata leaks')
 for(const row of f.rows){const projected=snapshot.items.find(i=>i.id===row.id);assert.equal(projected.type,'Aktivitet');assert.deepEqual(projected.person_ids,row.person_ids);assert.equal(projected.data.aulaAssisted,true);assert.equal(projected.data.aulaSourceKind,'message');for(const k of ['rewardMode','starValue','requiresApproval','allowanceContractId'])assert.equal(projected.data[k],undefined)}pass('Real Aula accept yields activities with exact people and only safe source label on wall')
 const signed=await must(f.wall.storage.from('household-avatars').createSignedUrl(f.photoPath,300));assert.equal((await fetch(signed.signedUrl)).status,200);pass('Anonymous paired wall can display current private avatar photo')
 assert.ok((await f.wall.storage.from('household-avatars').createSignedUrl(f.orphanPath,300)).error);assert.ok((await f.stranger.storage.from('household-avatars').createSignedUrl(f.photoPath,300)).error);pass('Orphan and unpaired/cross-family avatar reads denied')
 const removed=await f.wall.storage.from('household-avatars').remove([f.photoPath]);assert.ok(removed.error||removed.data.length===0);const overwrite=await f.wall.storage.from('household-avatars').upload(f.photoPath,Buffer.from('forbidden'),{contentType:'image/png',upsert:true});assert.ok(overwrite.error);pass('Wall avatar delete/update denied')
 for(const table of ['aula_connections','aula_child_mappings','aula_findings','calendar_feeds','profiles']){const r=await f.wall.from(table).select('*');assert.ok(r.error||r.data.length===0,table)}pass('Wall cannot read Aula admin, profile or feed tables')
 assert.ok((await f.stranger.rpc('wall_snapshot')).error);pass('Unpaired identity cannot obtain any snapshot')
 await must(f.client.rpc('manage_wall_device',{p_device_id:f.device.id,p_action:'revoke'}));assert.ok((await f.wall.rpc('wall_snapshot')).error);assert.ok((await f.wall.storage.from('household-avatars').createSignedUrl(f.photoPath,300)).error);pass('Revocation denies both snapshot and new photo signing')
 writeFileSync(join(reviewRoot,'wall-avatar-api-results.json'),JSON.stringify({status:'PASS',checks,synthetic:true},null,2))
}finally{await f.cleanup()}
