// A class label is 3.C, 3C or 3 C. Lowercase standalone prepositions in
// homework ('side 30 i format', 'side 3 i bogen') are NOT class recipients.
export function schoolClasses(text:string):string[]{
 return [...text.matchAll(/\b(10|[0-9])(?:\.\s*([a-zA-Z])|([a-zA-Z])|\s+([A-Z]))\b/g)].map(m=>(m[1]+(m[2]??m[3]??m[4])).toLowerCase());
}
