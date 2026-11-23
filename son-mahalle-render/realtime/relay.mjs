
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { guestFrame } from '../lib/city-frame.mjs';
import { hydrateCheckpoint } from '../public/game/checkpoint-codec.js';
import { encodeState, decodeState } from '../public/game/state-patch.js';

export function createRelay({origin, region, maxRooms=100,clock=Date.now,verifyAdmin}){
  const rooms=new Map();
  const server=createServer((req,res)=>{
    res.writeHead(req.url==='/health'?200:404,{'Content-Type':'application/json'});
    res.end(JSON.stringify({region,protocol:2,features:['command-push','webrtc-signaling']}));
  });
  const sockets=new WebSocketServer({noServer:true,maxPayload:1_800_000,perMessageDeflate:{threshold:512,concurrencyLimit:4,serverNoContextTakeover:true,clientNoContextTakeover:true,zlibDeflateOptions:{level:3,memLevel:7}}});
  const active=(player,now)=>now-player.seen<12000;
  const text=(v,n)=>String(v??'').replace(/[<>&"']/g,'').slice(0,n);
  const actions=new Set(['door','class','respawn','relocate','medicine','craftbomb','explosive','step','fire','interact','rescue','assign','place','wall','upgrade','improve','repair','heal','autobuild','wavepick']);
  const number=(v,fallback=0)=>Number.isFinite(v)?Math.max(-1e7,Math.min(1e7,v)):fallback;

  function enqueue(room,player,entries,now){
    if(!Array.isArray(entries))return;
    for(const entry of entries.slice(0,8)){
      if(!entry||!actions.has(entry.kind)||typeof entry.nonce!=='string'||room.commands.length>=300)continue;
      if(now-player.actionWindow>=1000){player.actionWindow=now;player.actionCount=0;}
      if(player.actionCount>=35)break;
      player.actionCount++;
      const command={kind:entry.kind,nonce:text(entry.nonce,60),arg:typeof entry.arg==='number'?number(entry.arg):text(entry.arg,24),
        weapon:text(entry.weapon,24),x:number(entry.x),y:number(entry.y),angle:number(entry.angle)};
      room.commands.push({id:++room.sequence,player:player.id,body:JSON.stringify(command)});
    }
    // Commands remain queued until the host acknowledges them. Push the same IDs
    // immediately, so normal polling is a recovery path rather than input latency.
    const host=room.players.get(room.host);
    if(host?.socket?.readyState===1&&room.commands.length)
      host.socket.send(JSON.stringify({event:'commands',room:room.id,commands:room.commands.slice(0,80)}));
  }

  const adminCheck=verifyAdmin|| (async key=>{
    const response=await fetch(origin+'/api/wave-admin',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify({key}),signal:AbortSignal.timeout(5000)});
    return response.status===204;
  });
  function pruneRooms(now=clock()){
    for(const [id,room] of rooms){
      for(const [pid,player] of room.players)if(now-player.seen>60_000){room.updated=Math.max(room.updated,player.seen);room.players.delete(pid);}
      if(![...room.players.values()].some(p=>active(p,now))&&now-room.updated>=10*60_000)rooms.delete(id);
    }
  }
  server.pruneRooms=pruneRooms;
  async function dispatch(client,b){
    const now=clock();
    if(b.op==='ping')return {region};
    if(b.op==='list'||b.op==='join')pruneRooms(now);
    if(b.op==='close'){
      if(typeof b.key!=='string'||b.key.length>128||now<(client.adminAfter||0))throw Error('admin_required');
      client.adminAfter=now+2000;
      if(!await adminCheck(b.key))throw Error('admin_required');
      const id=text(b.room,6).toUpperCase();if(!rooms.has(id))throw Error('lobby_not_found');rooms.delete(id);return {ok:true,closed:id};
    }
    const mode=b.gameMode==='waves'?'waves':'city';
    if(b.op==='list')return {rooms:[...rooms.values()].filter(room=>room.mode===mode)
      .map(room=>({id:room.id,name:room.name,players:[...room.players.values()].filter(p=>active(p,now)).length})).slice(-20)};
    if(b.op==='join'){
      if(client.player)throw Error('already_joined');
      let room=rooms.get(text(b.room,6).toUpperCase());
      if(b.mode==='create'){
        if(rooms.size>=maxRooms)throw Error('region_full');
        let id;
        do { id=(mode==='waves'?'W': 'R')+randomBytes(3).toString('hex').slice(0,5).toUpperCase(); }while(rooms.has(id));
        room={id,name:text(b.lobbyName,40)||'Son Mahalle',mode,players:new Map(),commands:[],sequence:0,revision:0,updated:now};
        rooms.set(id,room);
      }
      if(!room||room.mode!==mode)throw Error('lobby_not_found');
      if(room.players.size>=24)throw Error('lobby_full');
      const player={id:randomUUID(),token:randomUUID()+randomUUID(),name:text(b.name,24)||'Survivor',
        x:405,y:540,angle:0,seen:now,actionWindow:now,actionCount:0,room:room.id};
      player.socket=client.socket;
      room.players.set(player.id,player);room.updated=now;
      client.player=player;
      return {id:player.id,token:player.token,room:room.id,lobbyName:room.name,region};
    }
    if(b.op==='resume'){
      const room=rooms.get(b.room);
      const player=room?.players.get(b.id);
      if(!player||player.token!==b.token)throw Error('session_expired');
      client.player=player;
      player.socket=client.socket;
      return {ok:true};
    }
    const player=client.player;
    const room=rooms.get(player?.room);
    if(!room)throw Error('lobby_closed');
    if(room.players.get(player.id)!==player||player.id!==b.id)throw Error('session_expired');
    if(b.op==='leave'){
      room.players.delete(player.id);room.updated=now;
      if(room.host===player.id)room.host=null;
      client.player=null;
      return {ok:true};
    }
    if(b.op==='actions'){
      if(room.host!==player.id)enqueue(room,player,b.commands,now);
      return {accepted:true};
    }
    if(b.op==='signal'){
      const target=room.players.get(b.to);
      if(!target||target.id===player.id||(room.host!==player.id&&room.host!==target.id))throw Error('signal_target');
      if(now-(player.signalWindow||0)>10000){player.signalWindow=now;player.signalCount=0;}
      if((player.signalCount=(player.signalCount||0)+1)>240)throw Error('slow_down');
      const input=b.payload;let payload;
      if(input?.description&&['offer','answer'].includes(input.description.type)&&typeof input.description.sdp==='string'&&input.description.sdp.length<=64000)
        payload={description:{type:input.description.type,sdp:input.description.sdp}};
      else if(input?.candidate&&typeof input.candidate.candidate==='string'&&input.candidate.candidate.length<=2000)
        payload={candidate:{candidate:input.candidate.candidate,sdpMid:typeof input.candidate.sdpMid==='string'?input.candidate.sdpMid.slice(0,32):null,sdpMLineIndex:Number.isInteger(input.candidate.sdpMLineIndex)?input.candidate.sdpMLineIndex:null}};
      else throw Error('signal_payload');
      if(target.socket?.readyState!==1)throw Error('signal_offline');
      target.socket.send(JSON.stringify({event:'signal',room:room.id,from:player.id,payload}));
      return {accepted:true};
    }
    if(b.op!=='tick')throw Error('operation');
    if(player.lastTick&&now-player.lastTick<18)throw Error('slow_down');
    player.lastTick=now;
    const x=number(b.x,player.x), y=number(b.y,player.y);
    const step=Math.hypot(x-player.x,y-player.y);
    const limit=100+230*Math.min(10,(now-player.seen)/1000);
    const ratio=step>limit?limit/step:1;
    player.x+=(x-player.x)*ratio;
    player.y+=(y-player.y)*ratio;
    player.angle=number(b.angle);
    player.seen=now;
    room.updated=now;
    if(room.host===player.id&&b.visible===false)room.host=null;
    if(b.visible!==false&&(!room.host||now-room.hostSeen>2500))room.host=player.id;
    const host=room.host===player.id;
    if(host)room.hostSeen=now;
    if(host&&(b.snapshot||b.snapshotWire)){
      const packed=b.snapshotWire
        ? decodeState(b.snapshotWire,client.uploadState,client.uploadRevision)
        : b.snapshot;
      const snapshot=hydrateCheckpoint(packed,room.snapshot);
      if(!Array.isArray(snapshot.buildings)||!Array.isArray(snapshot.zombies)||!Array.isArray(snapshot.avatars)||!snapshot.res)throw Error('invalid_world');
      for(const avatar of snapshot.avatars){
        const target=room.players.get(avatar.id);
        const previous=room.snapshot?.avatars.find(a=>a.id===avatar.id);
        if(target&&avatar.hp>0&&avatar.respawnSeq>(previous?.respawnSeq||0)){
          target.x=number(avatar.x,target.x);
          target.y=number(avatar.y,target.y);
        }
      }
      room.snapshot=snapshot;
      if(b.snapshotWire){
        client.uploadState=packed;
        client.uploadRevision=b.snapshotWire.revision;
      }else if(b.wireVersion===1){
        client.uploadState=packed;
        client.uploadRevision=b.snapshotVersion;
      }
      room.revision++;
      if(Number.isInteger(b.ack))room.commands=room.commands.filter(c=>c.id>b.ack);
      if(Array.isArray(b.results))for(const result of b.results.slice(0,50)){
        const receiver=room.players.get(result?.player);
        if(receiver)receiver.result={kind:result.kind==='encounter'?'encounter':'feedback',message:text(result.message,250)};
      }
    }else if(!host)enqueue(room,player,b.commands,now);
    const players=[...room.players.values()].filter(p=>active(p,now)).map(({id,name,x,y,angle})=>({id,name,x,y,angle}));
    const unchanged=!host&&!!b.mapKey&&b.sinceRevision===room.revision;
    const snapshot=room.snapshot&&!unchanged?(host?(b.wasHost?null:room.snapshot):guestFrame(room.snapshot,b,players)):null;
    const result=player.result;
    player.result=null;
    const response={room:room.id,lobbyName:room.name,host,hostId:room.host,rtc:true,revision:room.revision,geometryId:room.snapshot?.geometryId||'',
      snapshot,unchanged,players,commands:host?room.commands.slice(0,80):[],result,serverTime:now};
    if(b.wireVersion===1){
      response.wireVersion=1;
      response.snapshotAck=client.uploadRevision||0;
      if(snapshot){
        const compatible=b.frameAck===client.frameRevision;
        const next=(client.frameRevision||0)+1;
        const frame=encodeState(snapshot,compatible?client.frameState:null,client.frameRevision,next);
        response.snapshot=null;
        response.snapshotWire=frame.wire;
        client.frameState=frame.state;
        client.frameRevision=next;
      }
    }
    return response;
  }

  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/coop'||req.headers.origin!==origin||sockets.clients.size>=maxRooms*24){
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
  });
  sockets.on('connection',socket=>{
    const client={player:null,socket};
    let window=0, messages=0;
    socket.on('error',()=>socket.terminate());
    socket.on('pong',()=>{socket.alive=true;});
    socket.alive=true;
    socket.on('message',async (raw,binary)=>{
      const now=clock();
      if(now-window>=1000){window=now;messages=0;}
      if(binary||++messages>65||socket.bufferedAmount>2_000_000){socket.close(1008);return;}
      let packet;
      try{
        packet=JSON.parse(raw);
        if(!Number.isInteger(packet?.seq)||!packet.body)throw Error('packet');
        socket.send(JSON.stringify({seq:packet.seq,data:await dispatch(client,packet.body)}));
      }catch(error){
        if(Number.isInteger(packet?.seq))socket.send(JSON.stringify({seq:packet.seq,error:error.message}));
      }
    });
  });
  const cleanup=setInterval(()=>{
    const now=clock();
    for(const socket of sockets.clients){
      if(!socket.alive){socket.terminate();continue;}
      socket.alive=false;socket.ping();
    }
    pruneRooms(now);
  },15000);
  cleanup.unref();
  server.on('close',()=>{clearInterval(cleanup);sockets.close();});
  return server;
}

