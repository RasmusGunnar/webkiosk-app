import sharp from 'sharp'
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs'
import {dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const source=readFileSync('resources/icon.svg')
async function png(path,size,{foreground=false,splash=false}={}){
 mkdirSync(dirname(path),{recursive:true})
 if(foreground||splash){
  const mark=await sharp(source).resize(Math.round(size*(splash?.22:.62))).png().toBuffer()
  await sharp({create:{width:size,height:size,channels:4,background:foreground?{r:0,g:0,b:0,alpha:0}:'#f4f7fb'}}).composite([{input:mark,gravity:'centre'}]).png().toFile(path)
 }else await sharp(source).resize(size).flatten({background:'#143d59'}).png().toFile(path)
}
writeFileSync('public/favicon.svg',source)
for(const size of [192,512])await png('public/icons/icon-'+size+'.png',size)
await png('public/icons/apple-touch-icon.png',180)
for(const [dpi,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})){
 const dir='android/app/src/main/res/mipmap-'+dpi
 for(const name of ['ic_launcher','ic_launcher_round'])await png(dir+'/'+name+'.png',size)
 await png(dir+'/ic_launcher_foreground.png',Math.round(size*2.25),{foreground:true})
}
for(const dir of readdirSync('android/app/src/main/res').filter(v=>v.startsWith('drawable')))if(readdirSync('android/app/src/main/res/'+dir).includes('splash.png'))await png('android/app/src/main/res/'+dir+'/splash.png',1024,{splash:true})
await png('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',1024)
for(const name of ['splash-2732x2732.png','splash-2732x2732-1.png','splash-2732x2732-2.png'])await png('ios/App/App/Assets.xcassets/Splash.imageset/'+name,2732,{splash:true})
console.log('Generated web, Android and iOS assets from resources/icon.svg')
