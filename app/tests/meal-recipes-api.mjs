// Real local Auth, RLS, pairing, private Storage and revocation; no hosted writes.
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,createHash} from 'node:crypto'
import {writeFileSync,mkdirSync} from 'node:fs'
import sharp from 'sharp'
import handler,{thumbnail,imageObjectPath,recipeIds} from '../server/meal-recipes.ts'
import {wallAvatarFixture,must,fixtureDate} from './fixtures/wall-avatar.js'
const f=await wallAvatarFixture(),checks=[],rid=randomUUID(),unplanned=randomUUID(),meal=randomUUID(),path=`${f.hid}/${rid}/${randomUUID()}.jpg`,beforeEnv={...process.env}
Object.assign(process.env,f.env)
const pass=name=>{checks.push(name);console.log('PASS '+name)}
async function request(token,{method='POST',ids=[rid],id=rid}={}){let status=200,body;const headers={};await handler({method,headers:{...(token?{authorization:'Bearer '+token}:{})},query:{id},body:{ids}},{setHeader(k,v){headers[k]=v},status(s){status=s;return this},json(value){body=value;return this},send(value){body=value;return this},end(){return this}});return {status,body,headers}}
const hash=b=>createHash('sha256').update(b).digest('hex')
try{
 const source=await sharp(randomBytes(2000*1500*3),{raw:{width:2000,height:1500,channels:3}}).jpeg({quality:95}).toBuffer();assert.ok(source.length>2*1024*1024&&source.length<5*1024*1024)
 await must(f.client.from('recipes').insert([{id:rid,household_id:f.hid,title:'Syntetisk tomatsuppe',image_path:path,servings:4,total_minutes:25},{id:unplanned,household_id:f.hid,title:'Ikke planlagt'}]))
 await must(f.client.from('recipe_ingredients').insert({recipe_id:rid,position:0,raw_text:'800 g tomater'}));await must(f.client.from('recipe_instructions').insert({recipe_id:rid,position:0,text:'Blend suppen.'}));await must(f.client.from('recipe_ratings').insert({recipe_id:rid,person_id:f.carl.id,rating:'love'}))
 await must(f.client.storage.from('recipe-images').upload(path,source,{contentType:'image/jpeg'}))
 await must(f.admin.from('calendar_items').insert({id:meal,household_id:f.hid,created_by:f.user.id,title:'Tomatsuppe',type:'Madplan',date:fixtureDate,data:{recipe_id:rid}}))
 const before=await must(f.client.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*),recipe_ratings(*)').eq('id',rid).single())
 assert.equal((await request(null)).status,401);assert.equal((await request('invalid')).status,401);pass('Unauthorized and invalid credentials rejected')
 const normal=await request(f.session.access_token);assert.equal(normal.status,200);assert.equal(normal.body.recipes[0].recipe_ingredients[0].raw_text,'800 g tomater');pass('Existing recipe RLS permits member reads')
 const paired=await request(f.wallSession.access_token);assert.equal(paired.status,200);assert.equal(paired.body.recipes[0].recipe_instructions[0].text,'Blend suppen.');assert.equal(paired.body.recipes[0].recipe_ratings[0].rating,'love');assert.equal(paired.body.recipes[0].created_by,undefined);assert.equal(paired.body.recipes[0].original_image_url,undefined);pass('Paired wall gets only planned household recipe DTO, ingredients, instructions and ratings')
 assert.equal((await request(f.wallSession.access_token,{ids:[unplanned]})).status,403);const outsider=(await f.stranger.auth.getSession()).data.session;assert.equal((await request(outsider.access_token)).status,403);pass('Unplanned recipes and unpaired/cross-household wall reads denied')
 for(const ids of [['http://127.0.0.1'],['../private'],Array(25).fill(rid)])assert.equal((await request(f.session.access_token,{ids})).status,400);assert.throws(()=>recipeIds(['x']));assert.throws(()=>imageObjectPath({id:rid,household_id:f.hid,image_path:f.hid+'/'+rid+'/../secret.jpg'}));pass('Only bounded UUID requests and owned object paths accepted')
 const image=await request(f.wallSession.access_token,{method:'GET'});assert.equal(image.status,200);assert.equal(image.headers['Content-Type'],'image/webp');assert.ok(image.body.length<384*1024);const meta=await sharp(image.body).metadata();assert.ok(meta.width<=640&&meta.height<=480);assert.equal(meta.exif,undefined);pass('Multi-megabyte original becomes bounded 640px WebP without metadata')
 assert.deepEqual(await must(f.client.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*),recipe_ratings(*)').eq('id',rid).single()),before);assert.equal(hash(Buffer.from(await (await must(f.client.storage.from('recipe-images').download(path))).arrayBuffer())),hash(source));pass('Original image, recipe, ingredients, instructions and ratings unchanged')
 await assert.rejects(()=>thumbnail(new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})));await assert.rejects(()=>thumbnail(new Response(new Uint8Array(5*1024*1024+1),{headers:{'content-type':'image/jpeg'}})));await assert.rejects(()=>thumbnail(new Response('invalid',{headers:{'content-type':'image/jpeg'}})));pass('SVG, oversized streams and malformed images rejected')
 await must(f.client.rpc('manage_wall_device',{p_device_id:f.device.id,p_action:'revoke'}));assert.equal((await request(f.wallSession.access_token)).status,403);assert.equal((await request(f.wallSession.access_token,{method:'GET'})).status,403);pass('Revocation immediately denies metadata and new image requests')
 const out=new URL('../../supabase/.temp/design-polish/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('meal-api.json',out),JSON.stringify({checks,sourceBytes:source.length,thumbnailBytes:image.body.length,width:meta.width,height:meta.height,originalUnchanged:true},null,2))
}finally{await f.admin.storage.from('recipe-images').remove([path]);await f.cleanup();for(const k of Object.keys(f.env)){if(beforeEnv[k]===undefined)delete process.env[k];else process.env[k]=beforeEnv[k]}}
