// The permanent Cloudflare token never leaves this server.
export function createTurnProvider({keyId,apiToken,clock=Date.now,request=fetch,maxUsers=2400}={}){
  const enabled=typeof keyId==='string'&&/^[a-f0-9]{32}$/i.test(keyId)&&typeof apiToken==='string'&&apiToken.length>=20&&!/[\r\n]/.test(apiToken);
  const cache=new Map(),ttl=21600;let windowAt=0,issued=0;
  const allowed=/^(?:stun|turn|turns):(?:stun|turn)\.cloudflare\.com:(?:3478|443|5349)(?:\?transport=(?:udp|tcp))?$/;
  return {
    enabled,
    remove(id){cache.delete(id);},
    async get(id){
      if(!enabled)throw Error('turn_not_configured');
      const now=clock(),current=cache.get(id);
      if(current&&now<current.renewAt){if(current.pending)return current.pending;if(current.value)return current.value;throw Error('turn_unavailable');}
      if(now-windowAt>=60000){windowAt=now;issued=0;}
      if(issued>=120||!current&&cache.size>=maxUsers)throw Error('turn_rate_limit');
      issued++;
      const record={renewAt:now+30000};cache.set(id,record);
      record.pending=(async()=>{
        try{
          const response=await request('https://rtc.live.cloudflare.com/v1/turn/keys/'+keyId+'/credentials/generate-ice-servers',{
            method:'POST',headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},
            body:JSON.stringify({ttl}),signal:AbortSignal.timeout(5000)
          });
          if(response.status!==201)throw Error('turn_unavailable');
          const data=await response.json(),iceServers=[];
          for(const server of (Array.isArray(data.iceServers)?data.iceServers:[data.iceServers]).slice(0,6)){
            if(!server)continue;
            const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(url=>typeof url==='string'&&allowed.test(url)).slice(0,8);
            if(!urls.length)continue;
            const relay=urls.some(url=>/^turns?:/.test(url));
            if(relay&&(typeof server.username!=='string'||typeof server.credential!=='string'||server.username.length>1024||server.credential.length>1024))throw Error('turn_unavailable');
            iceServers.push({urls,...(relay?{username:server.username,credential:server.credential}:{})});
          }
          if(!iceServers.some(server=>server.urls.some(url=>/^turns?:/.test(url))))throw Error('turn_unavailable');
          record.value={iceServers,expiresAt:now+ttl*1000,refreshAfter:3*60*60*1000};
          record.renewAt=now+3*60*60*1000;return record.value;
        }catch{record.renewAt=clock()+30000;throw Error('turn_unavailable');}
        finally{record.pending=null;}
      })();
      return record.pending;
    }
  };
}
