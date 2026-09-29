import { validateDeletionInput } from '../delete-account/validation.ts'
const assert=(value:unknown)=>{if(!value)throw Error('Assertion failed')}
Deno.test('Deletion requires an explicit confirmation, reauth password and bounded UUID list',()=>{
 const valid={confirmation:'SLET MIN KONTO',password:'test-only',delete_household_ids:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']}
 assert(validateDeletionInput(valid).delete_household_ids.length===1)
 for(const data of [null,{}, {...valid,confirmation:'yes'},{...valid,password:''},{...valid,delete_household_ids:['other']},{...valid,delete_household_ids:Array(101).fill(valid.delete_household_ids[0])}]){
  let failed=false;try{validateDeletionInput(data)}catch{failed=true}assert(failed)
 }
})
