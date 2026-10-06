import test from 'node:test'
import assert from 'node:assert/strict'
import {canEditImported,visibleImports} from '../src/lib/imported-editor.js'
import {feedSyncStatus} from '../src/lib/feeds.js'
test('Legacy JSON-only imported events route to editable editor',()=>{assert.equal(canEditImported({source:null,calendar_id:null,data:{source:'google',feedId:'stable-feed',uid:'stable-uid',recurrenceId:null}}),true);assert.equal(canEditImported({data:{title:'manual'}}),false)})
test('Source cancellations and local exclusions disappear without hiding manual lookalikes',()=>assert.deepEqual(visibleImports([{id:'manual'},{id:'cancelled',data:{importSourceRemoved:true}},{id:'hidden',data:{importHidden:true}}]).map(i=>i.id),['manual']))
test('Feed status uses successful timestamp and safe errors, never private links',()=>{assert.match(feedSyncStatus({last_sync_at:'2026-10-06T10:00:00Z',last_sync_status:'success'},Date.parse('2026-10-06T10:03:00Z')),/3 min/);assert.match(feedSyncStatus({last_sync_status:'error',last_sync_message:'https://example.com/private'}),/Kunne ikke/);assert.ok(!feedSyncStatus({last_sync_status:'error',last_sync_message:'https://example.com/private'}).includes('https:'));assert.match(feedSyncStatus({is_active:false}),/Inaktiv/)})
