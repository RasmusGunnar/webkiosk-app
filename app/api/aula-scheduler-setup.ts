import {makeHandlers} from '../server/aula/service.ts';
// One-use, expiring capability issued only by the database administrator.
// Copies the existing server secret to Vault; it cannot scan or return secrets.
export const config={maxDuration:30};
export default makeHandlers().setup;
