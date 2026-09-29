export function validateDeletionInput(value: unknown): {password:string;delete_household_ids:string[]} {
 const data=value as Record<string,unknown>
 if(!data||data.confirmation!=='SLET MIN KONTO'||typeof data.password!=='string'||data.password.length<1||data.password.length>1024||!Array.isArray(data.delete_household_ids)||data.delete_household_ids.length>100||data.delete_household_ids.some(id=>typeof id!=='string'||!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)))throw Error('Invalid deletion request')
 return {password:data.password,delete_household_ids:[...new Set(data.delete_household_ids as string[])]}
}
