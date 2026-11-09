import {makeHandlers} from '../server/aula/service.ts';
export const config={maxDuration:300};
export default makeHandlers().scan;
