import {makeHandoffHandlers} from '../server/aula/handoff.ts';
export const config={maxDuration:90};
export default makeHandoffHandlers().accept;
