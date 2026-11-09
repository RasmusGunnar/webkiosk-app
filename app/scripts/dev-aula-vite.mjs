import {createServer} from 'vite'
import {fileURLToPath} from 'node:url'
if(process.env.VITE_SUPABASE_URL!=='http://127.0.0.1:49321')throw Error('Aula development must use its isolated local stack')
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{host:'127.0.0.1',port:Number(process.env.PORT||5199),strictPort:true}})
await server.listen()
