import test from 'node:test'
import assert from 'node:assert/strict'
import {hiddenImportLabel,importedPersonSelection} from '../src/lib/imported-scopes.js'
test('Hidden rule labels distinguish occurrence, future boundary and whole series',()=>{
 assert.equal(hiddenImportLabel({scope:'future',effective_date:'2026-10-15',date:'2026-10-06'}),'Skjult fra 15. oktober 2026')
 assert.equal(hiddenImportLabel({scope:'occurrence',date:'2026-10-08'}),'Enkelt forekomst · 8. oktober 2026')
 assert.equal(hiddenImportLabel({occurrence:'*'}),'Hele serien skjult')
 assert.equal(hiddenImportLabel({scope:'future',effective_date:'broken'}),'Skjult fra den valgte forekomst')
})
test('A partial people list cannot silently create an unassignment override',()=>{
 assert.deepEqual(importedPersonSelection([],['mor'],[]),['mor'])
 assert.deepEqual(importedPersonSelection(['jakob'],['mor','archived'],[{id:'mor'},{id:'jakob'}]),['jakob','archived'])
 assert.deepEqual(importedPersonSelection([],['mor'],[{id:'mor'}]),[])
})
