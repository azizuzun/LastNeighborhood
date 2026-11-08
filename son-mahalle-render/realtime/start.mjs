import { createRelay } from './relay.mjs';
const { SITE_ORIGIN, COOP_REGION, PORT='8080' }=process.env;
if(!SITE_ORIGIN||!COOP_REGION)throw Error('Set SITE_ORIGIN and COOP_REGION');
createRelay({origin:new URL(SITE_ORIGIN).origin,region:COOP_REGION}).listen(Number(PORT),'0.0.0.0');
