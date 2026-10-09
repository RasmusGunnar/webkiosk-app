import {t} from './index.js'
// These are persisted domain values. Translate only at the rendering boundary.
const types={Aktivitet:'activity',Fritidsinteresse:'hobby',Opgave:'task','Fødselsdag':'birthday',Madplan:'meal',Indkøb:'shopping',Andet:'other'}
export const typeLabel=value=>types[value]?t('types.'+types[value]):value
export const personRoleLabel=value=>t('roles.'+({Barn:'child',barn:'child',child:'child',Voksen:'adult',voksen:'adult',adult:'adult'}[value]||'family'))
const categories={'Frugt & grønt':'produce','Mejeri & æg':'dairy','Kød & fisk':'meat','Brød & kolonial':'pantry',Hjemmet:'household',Kolonial:'pantry','Frost':'frozen','Brød':'bread',Drikkevarer:'drinks',Husholdning:'household',Andet:'other'}
export const categoryLabel=value=>categories[value]?t('shopping.category.'+categories[value]):value
