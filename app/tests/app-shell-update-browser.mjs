// Real Chromium service workers, two successful local releases and a failed one.
import {chromium,expect} from '@playwright/test'
import {createServer} from 'node:http'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {build} from 'vite'
import {reviewRoot} from '../scripts/aula-local.mjs'
const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:new URL('../src/lib/app-shell-update.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),formats:['es'],fileName:'updater'},rollupOptions:{output:{inlineDynamicImports:true}}}})
const code=bundle[0].output.find(f=>f.type==='chunk').code,template=readFileSync(new URL('../src/sw-template.js',import.meta.url),'utf8'),checks=[]
let release='A',swFetches=0
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname
 res.setHeader('cache-control','no-store')
 if(path==='/sw.js'){swFetches++;res.setHeader('content-type','text/javascript');const files=['./','./index.html',`./assets/updater-${release}.js`,`./assets/style-${release}.css`,`./assets/lazy-${release}.js`];res.end(template.replace('__VERSION__',release).replace('__PRECACHE__',JSON.stringify(files)));return}
 if(path==='/'||path==='/index.html'){res.setHeader('content-type','text/html');res.end(`<!doctype html><html lang="da"><head><link rel="stylesheet" href="/assets/style-${release}.css"></head><body data-mode="wall"><h1 id="version">${release}</h1><button id="edit">Editor</button><div id="editor"></div><script type="module">import{installShellUpdates}from'/assets/updater-${release}.js';window.unsynced=false;installShellUpdates({url:'/sw.js',isWall:()=>document.body.dataset.mode==='wall',canReload:()=>!window.unsynced,checkMs:500,idleMs:500,tickMs:100});document.querySelector('#edit').onclick=()=>{document.querySelector('#editor').innerHTML='<section role="dialog"><textarea aria-label="Draft"></textarea><button id="close">Close</button></section>';document.querySelector('#close').onclick=()=>document.querySelector('#editor').replaceChildren()};</script></body></html>`);return}
 if(path===`/assets/updater-${release}.js`&&release!=='D'){res.setHeader('content-type','text/javascript');res.end(code);return}
 if(path===`/assets/lazy-${release}.js`){res.setHeader('content-type','text/javascript');res.end(`export default '${release}'`);return}
 if(path===`/assets/style-${release}.css`){res.setHeader('content-type','text/css');res.end('body{font:18px system-ui}');return}
 if(path==='/api/private'){res.setHeader('content-type','application/json');res.end('{"synthetic":"not cached"}');return}
 res.statusCode=404;res.end('not found')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({locale:'da-DK'}),page=await context.newPage();page.setDefaultTimeout(12000)
const pass=name=>{checks.push(name);console.log('PASS '+name)}
try{
 await page.goto(base);await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));expect(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).updateViaCache)).toBe('none');pass('Real service worker installs; update checks bypass browser cache')
 await context.setOffline(true);await page.reload();await expect(page.locator('#version')).toHaveText('A');await context.setOffline(false);pass('Installed shell remains usable offline')
 await page.locator('#edit').click();await page.locator('textarea').fill('Unsaved synthetic draft');release='B'
 await expect(page.locator('.shell-update-notice')).toBeVisible();await page.waitForTimeout(800);await expect(page.locator('#version')).toHaveText('A');await expect(page.locator('textarea')).toHaveValue('Unsaved synthetic draft');pass('Periodic check finds new release without navigation; editor prevents reload')
 expect(await page.evaluate(async()=>(await import('/assets/lazy-A.js')).default)).toBe('A');pass('Previous hashed assets survive while old page finishes editing')
 await page.evaluate(()=>window.unsynced=true);await page.locator('#close').click();await page.waitForTimeout(800);await expect(page.locator('#version')).toHaveText('A');pass('Unsynced work blocks automatic reload')
 await page.evaluate(()=>window.unsynced=false);await expect(page.locator('#version')).toHaveText('B');await page.waitForTimeout(800);await expect(page.locator('.shell-update-notice')).toHaveCount(0);pass('Idle wall reloads into new shell once, without a reload loop')
 await page.evaluate(()=>document.body.dataset.mode='desktop');release='C';await expect(page.locator('.shell-update-notice')).toBeVisible();await page.waitForTimeout(800);await expect(page.locator('#version')).toHaveText('B');await page.locator('.shell-update-notice button').click();await expect(page.locator('#version')).toHaveText('C');pass('Web user chooses update; no forced reload during interaction')
 await page.evaluate(()=>fetch('/api/private'));expect(await page.evaluate(async()=>{for(const key of await caches.keys())if(await(await caches.open(key)).match('/api/private'))return true;return false})).toBe(false);pass('API responses never enter shell caches')
 release='D';const before=swFetches;await expect.poll(()=>swFetches).toBeGreaterThan(before);await page.waitForTimeout(800);await context.setOffline(true);await page.reload();await expect(page.locator('#version')).toHaveText('C');pass('Failed deployment install retains complete prior offline shell')
 writeFileSync(join(reviewRoot,'pwa-update-results.json'),JSON.stringify({status:'PASS',checks},null,2))
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve))}
