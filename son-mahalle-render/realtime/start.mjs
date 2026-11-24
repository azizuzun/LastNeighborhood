import { createRelay } from './relay.mjs';
const { SITE_ORIGIN, COOP_REGION, TURN_KEY_ID, TURN_API_TOKEN, PORT='8080' }=process.env;
if(!SITE_ORIGIN||!COOP_REGION)throw Error('Set SITE_ORIGIN and COOP_REGION');
createRelay({origin:new URL(SITE_ORIGIN).origin,region:COOP_REGION,turnKeyId:TURN_KEY_ID,turnApiToken:TURN_API_TOKEN}).listen(Number(PORT),'0.0.0.0');
