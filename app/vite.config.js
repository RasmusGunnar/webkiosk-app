import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
export default defineConfig({
  plugins:[{
    name:'familiekalender-offline-shell',apply:'build',enforce:'post',
    generateBundle(options,bundle){
      const files=['./','./index.html','./favicon.svg',...Object.keys(bundle).filter(name=>/\.(js|css|svg|png|ico|webmanifest)$/.test(name)).map(name=>'./'+name)]
      const version=createHash('sha256').update(files.join('\n')).digest('hex').slice(0,16)
      const source=readFileSync(new URL('./src/sw-template.js',import.meta.url),'utf8')
        .replace('__VERSION__',()=>version).replace('__PRECACHE__',()=>JSON.stringify(files))
      this.emitFile({type:'asset',fileName:'sw.js',source})
    },
  }],
})
