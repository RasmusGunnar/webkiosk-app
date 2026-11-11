import test from 'node:test';
import assert from 'node:assert/strict';
import {isoWeekDays,resolvePlanDate} from '../server/aula/meebook-date.ts';
test('Yearless labels resolve only when one calendar day fits the requested ISO week',()=>{
 assert.deepEqual(resolvePlanDate('11/12','2026-W46'),{date:'2026-11-12',order:'month_day'});
 assert.deepEqual(resolvePlanDate('12/11','2026-W46'),{date:'2026-11-12',order:'day_month'});
 assert.deepEqual(resolvePlanDate('11-16','2026-W47'),{date:'2026-11-16',order:'month_day'});
 assert.deepEqual(resolvePlanDate('11.11.','2026-W46'),{date:'2026-11-11',order:'same'});
 for(const value of ['9','2026','31/2','11/30','text',null])assert.equal(resolvePlanDate(value,'2026-W46').date,null);
});
test('Recognized yearless Danish/English labels resolve uniquely; wrong weekday, extra text and explicit unknown year never do',()=>{
 for(const label of ['Torsdag d. 12. november','12. nov.','November 12','Thursday, November 12th','torsdag 12 / 11','11 / 12'])assert.equal(resolvePlanDate(label,'2026-W46').date,'2026-11-12');
 for(const label of ['Fredag 12. november','12. private','November 2001','2001 November 12','12:11','No homework November 12'])assert.equal(resolvePlanDate(label,'2026-W46').date,null);
 assert.equal(resolvePlanDate('Torsdag d. 1. januar','2026-W01').date,'2026-01-01');
});
test('ISO week year boundaries supply the date year rather than Date.parse default 2001',()=>{
 assert.deepEqual(isoWeekDays('2026-W53'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.equal(resolvePlanDate('1/1','2026-W53').date,'2027-01-01');assert.equal(resolvePlanDate('12/31','2026-W53').date,'2026-12-31');
 assert.deepEqual(isoWeekDays('2025-W53'),[]);assert.deepEqual(isoWeekDays('2026-W00'),[]);
});
test('Qualified dates preserve Copenhagen days, reject invalid dates and outside-week values',()=>{
 assert.equal(resolvePlanDate('2026-11-12T00:00:00+01:00','2026-W46').date,'2026-11-12');
 assert.equal(resolvePlanDate('2026-11-11T23:00:00Z','2026-W46').date,'2026-11-12');
 assert.equal(resolvePlanDate('2026-11-12 00:00:00','2026-W46').date,'2026-11-12');
 for(const value of ['2026-02-31','2026-11-20','2001-11-12'])assert.equal(resolvePlanDate(value,'2026-W46').date,null);
});
