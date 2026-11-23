const kinds=['walker','runner','brute','screamer'];
const geometryFields=['buildings','sectors','sectorMeta','nextPersonId'];
export function geometryBuilding({door,...b}){return {...b,...(b.doors?{doors:b.doors.map(({open,locked,hp,maxHP,hit,...d})=>d)}:{}),...(b.fence?{fence:b.fence.map(({hp,...f})=>f)}:{})}}
export function packCheckpoint(s,knownGeometry=''){
  const geometry=[(s.buildings||[]).map(geometryBuilding),s.sectors,s.sectorMeta,s.nextPersonId];
  const str=JSON.stringify(geometry);let hash=2166136261;for(let i=0;i<str.length;i++)hash=Math.imul(hash^str.charCodeAt(i),16777619);
  const id=(hash>>>0).toString(36)+'-'+str.length,out={...s,geometryId:id};
  out.doorState=(s.buildings||[]).map((b,i)=>[i,b.door?.open?1:0,b.door?.locked?1:0,b.door?.hp??240,b.door?.hit||0,b.door?.maxHP||240]);
  out.survivors=(s.survivors||[]).map(({navigation,navPath,navAge,navTX,navTY,rx,ry,...c})=>c);
  out.crew=(s.crew||[]).map(({navigation,navPath,navAge,navTX,navTY,...c})=>c);
  out.portalState=(s.buildings||[]).flatMap((b,i)=>(b.doors||[]).map((d,j)=>[i,j,d.open?1:0,d.hp??240,d.hit||0,d.maxHP||240]));
  out.fenceState=(s.buildings||[]).flatMap((b,i)=>(b.fence||[]).map((f,j)=>[i,j,f.hp??120]));
  out.zombieState=(s.zombies||[]).map(z=>[z.netId||0,z.x,z.y,z.hp,Math.max(0,kinds.indexOf(z.kind)),z.angle||0,z.wander||0,z.alert||0,z.target?.x??null,z.target?.y??null,z.cry||0,z.slow||0,z.trapTimer||0,z.doorCooldown||0,z.maxHP||0,z.wound||0,z.burning||0,z.burnDamage||0,z.hurt||0,z.pockets||null,z.elite||null,z.mutation||null,z.variantCooldown||0,z.variantWindup||0,z.limbs||0,z.crawlAt||0,z.waveBurn||null]);
  delete out.zombies;
  if(knownGeometry===id){for(let k of geometryFields)delete out[k];out.geometryRef=id;}else out.buildings=geometry[0];
  return out;
}
export function hydrateCheckpoint(wire,previous){
  if(!wire||typeof wire!=='object')throw Error('invalid_world');
  if(wire.geometryRef&&(!previous||wire.geometryRef!==previous.geometryId))throw Error('geometry_mismatch');
  const s={...(wire.geometryRef?previous:{}),...wire};
  if(Array.isArray(wire.zombieState))s.zombies=wire.zombieState.slice(0,12000).filter(t=>Array.isArray(t)&&t.length>=10&&[t[1],t[2],t[3]].every(Number.isFinite)).map(t=>({netId:t[0],x:t[1],y:t[2],hp:t[3],kind:kinds[t[4]]||'walker',angle:t[5],wander:t[6],alert:t[7],target:t[8]===null||t[9]===null?null:{x:t[8],y:t[9]},cry:t[10],slow:t[11],trapTimer:t[12],doorCooldown:t[13],maxHP:t[14]||undefined,wound:t[15],burning:t[16],burnDamage:t[17],hurt:t[18],pockets:t[19]||undefined,elite:t[20]||undefined,mutation:t[21]||undefined,variantCooldown:t[22]||0,variantWindup:t[23]||0,limbs:t[24]||0,crawlAt:t[25]||0,waveBurn:t[26]||undefined}));
  if(Array.isArray(s.buildings)&&Array.isArray(wire.doorState))for(let t of wire.doorState){let b=s.buildings[t[0]];if(b)b.door={open:!!t[1],locked:!!t[2],hp:t[3],maxHP:t[5]||240,hit:t[4]||0};}
  if(Array.isArray(wire.fenceState))for(let t of wire.fenceState){let f=s.buildings?.[t[0]]?.fence?.[t[1]];if(f)f.hp=t[2];}
  if(Array.isArray(wire.portalState))for(let t of wire.portalState){let b=s.buildings?.[t[0]],d=b?.doors?.[t[1]];if(d){Object.assign(d,{open:!!t[2],locked:false,hp:t[3],hit:t[4],maxHP:t[5]});if(t[1]===0)b.door=d;}}
  delete s.portalState;delete s.fenceState;delete s.doorState;delete s.zombieState;delete s.geometryRef;return s;
}
