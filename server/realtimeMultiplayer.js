import crypto from "crypto";
import { addPlayer, command, RealtimeRoomStore, sanitizeSnapshot, normalizePlayerId } from "./realtimeSimulation.js";

const addDays=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+Math.round(days)*86400000).toISOString().slice(0,10);

const MAX_FRAME_BYTES=128*1024;
const RATE_WINDOW_MS=1000;
const MAX_COMMANDS_PER_WINDOW=30;

const encodeFrame=(text)=>{
  const payload=Buffer.from(text);
  const len=payload.length;
  let header;
  if(len<126) header=Buffer.from([0x81,len]);
  else if(len<65536){header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(len,2);}
  else {header=Buffer.alloc(10);header[0]=0x81;header[1]=127;header.writeBigUInt64BE(BigInt(len),2);}
  return Buffer.concat([header,payload]);
};
const encodeControl=(opcode,payload=Buffer.alloc(0))=>Buffer.concat([Buffer.from([0x80|opcode,payload.length]),payload]);
const decodeFrames=(buffer)=>{
  const frames=[];let offset=0;
  while(buffer.length-offset>=2){
    const b1=buffer[offset],b2=buffer[offset+1];
    const fin=(b1&0x80)!==0,opcode=b1&0x0f,masked=(b2&0x80)!==0;
    let len=b2&0x7f,pos=offset+2;
    if(len===126){if(buffer.length-pos<2)break;len=buffer.readUInt16BE(pos);pos+=2;}
    else if(len===127){if(buffer.length-pos<8)break;const big=buffer.readBigUInt64BE(pos);if(big>BigInt(MAX_FRAME_BYTES))throw new Error("Frame too large");len=Number(big);pos+=8;}
    if(!fin) throw new Error("Fragmented websocket frames are not supported");
    if(masked) {if(buffer.length-pos<4)break;const mask=buffer.subarray(pos,pos+4);pos+=4;if(buffer.length-pos<len)break;const data=Buffer.from(buffer.subarray(pos,pos+len));for(let i=0;i<len;i++)data[i]^=mask[i%4];frames.push({opcode,data});pos+=len;}
    else {if(buffer.length-pos<len)break;frames.push({opcode,data:buffer.subarray(pos,pos+len)});pos+=len;}
    offset=pos;
  }
  return {frames,remaining:buffer.subarray(offset)};
};

const json=(socket,value)=>{try{socket.write(encodeFrame(JSON.stringify(value)));}catch{ /* disconnected socket */ }};
const id=()=>crypto.randomBytes(12).toString("base64url");

export class RealtimeMultiplayer {
  constructor(server,{store=new RealtimeRoomStore()}={}) {
    this.server=server;this.store=store;this.clients=new Map();
    server.on("upgrade",(req,socket)=>{
      if(!req.url?.startsWith("/ws/realtime")) return;
      this.upgrade(req,socket);
    });
  }

  upgrade(req,socket){
    try{
      const origin=req.headers.origin;
      const host=String(req.headers.host||"");
      if(origin && origin!=="null"){
        const proto=String(req.headers["x-forwarded-proto"]||"http").split(",")[0].trim();
        if(origin!==proto+"://"+host) throw new Error("WebSocket origin rejected");
      }
      const key=req.headers["sec-websocket-key"];
      if(!key) throw new Error("Missing websocket key");
      const accept=crypto.createHash("sha1").update(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n");
      socket.setNoDelay(true);
      const client={socket,buffer:Buffer.alloc(0),playerId:null,roomId:null,commands:[]};
      this.clients.set(socket,client);
      socket.on("data",chunk=>this.onData(client,chunk));
      socket.on("close",()=>this.disconnect(client));
      socket.on("error",()=>this.disconnect(client));
      json(socket,{type:"CONNECTED",protocol:1});
    }catch(error){socket.destroy();}
  }

  onData(client,chunk){
    client.buffer=Buffer.concat([client.buffer,chunk]);
    if(client.buffer.length>MAX_FRAME_BYTES*2){client.socket.destroy();return;}
    try{
      const parsed=decodeFrames(client.buffer);client.buffer=parsed.remaining;
      for(const frame of parsed.frames){
        if(frame.opcode===0x8){client.socket.end(encodeControl(0x8));return;}
        if(frame.opcode===0x9){client.socket.write(encodeControl(0xA,frame.data));continue;}
        if(frame.opcode!==0x1) continue;
        this.message(client,JSON.parse(frame.data.toString("utf8")));
      }
    }catch(error){json(client.socket,{type:"ERROR",error:error.message});}
  }

  message(client,message){
    if(!message || typeof message.type!=="string") throw new Error("Invalid websocket message");
    const now=Date.now();
    client.commands=client.commands.filter(t=>now-t<RATE_WINDOW_MS);
    if(client.commands.length>=MAX_COMMANDS_PER_WINDOW){throw new Error("Command rate limit exceeded");}
    client.commands.push(now);
    switch(message.type){
      case "LIST_ROOMS": return this.listRooms(client);
      case "CREATE_ROOM": return this.createRoom(client,message);
      case "JOIN_ROOM": return this.joinRoom(client,message);
      case "SNAPSHOT": return this.snapshot(client);
      case "COMMAND": return this.command(client,message);
      case "CHAT": return this.chat(client,message);
      case "DIPLOMACY_REQUEST": return this.diplomacyRequest(client,message);
      case "DIPLOMACY_RESPONSE": return this.diplomacyResponse(client,message);
      default: throw new Error("Unknown websocket message type");
    }
  }

  listRooms(client){json(client.socket,{type:"ROOM_LIST",rooms:this.store.list().slice(0,50)});}

  createRoom(client,m){
    const playerId=normalizePlayerId(m.playerId)||id();
    const state=this.store.create({mode:m.mode==="multi"?"multi":"single",name:m.name,seed:Number(m.seed)||19200101});
    const countries=Object.keys(state.countries);
    const country=String(m.countryCode||"GBR").toUpperCase();
    addPlayer(state,{playerId,name:m.playerName,countryCode:country,host:true});
    this.attach(client,state.id,playerId);
    json(client.socket,{type:"ROOM_CREATED",roomId:state.id,playerId,countryCode:country,snapshot:sanitizeSnapshot(state)});
    this.broadcast(state.id,{type:"PLAYER_JOINED",player:state.players[playerId]});
  }

  joinRoom(client,m){
    const state=this.store.load(String(m.roomId||""));
    if(!state) throw new Error("Room not found");
    const playerId=normalizePlayerId(m.playerId)||id();
    addPlayer(state,{playerId,name:m.playerName,countryCode:m.countryCode,host:false});
    this.attach(client,state.id,playerId);
    this.broadcast(state.id,{type:"PLAYER_JOINED",player:state.players[playerId]},client);
    json(client.socket,{type:"ROOM_JOINED",roomId:state.id,playerId,snapshot:sanitizeSnapshot(state)});
  }

  attach(client,roomId,playerId){
    client.roomId=roomId;client.playerId=playerId;
    const state=this.store.load(roomId);
    if(state?.players[playerId]) state.players[playerId].connected=true;
  }

  snapshot(client){
    if(!client.roomId) throw new Error("Join a room first");
    const state=this.store.load(client.roomId);this.store.step(client.roomId);
    json(client.socket,{type:"SNAPSHOT",snapshot:sanitizeSnapshot(state)});
  }

  command(client,m){
    if(!client.roomId||!client.playerId) throw new Error("Join a room first");
    const state=this.store.load(client.roomId);
    command(state,client.playerId,m.action,m.payload||{});
    this.store.save(state);
    this.broadcast(client.roomId,{type:this.eventTypeFor(m.action),action:m.action,revision:state.sequence,snapshot:this.publicDelta(state,m.action,client.playerId)});
  }

  eventTypeFor(action){
    if(action==="SET_SPEED"||action==="PAUSE"||action==="RESUME") return "TIME_UPDATE";
    if(action==="BUILD") return "BUILDING_UPDATE";
    if(action==="RESEARCH") return "RESEARCH_UPDATE";
    if(action==="MOVE_UNIT") return "UNIT_UPDATE";
    if(action==="EVENT_CHOICE"||action==="ACTION") return "EVENT_RESOLVED";
    return "WORLD_UPDATE";
  }

  publicDelta(state,action,clientPlayerIdForDelta){
    if(action==="SET_SPEED"||action==="PAUSE"||action==="RESUME") return {clock:state.clock};
    if(action==="BUILD"||action==="RESEARCH"||action==="MOVE_UNIT") {
      const player=state.players[clientPlayerIdForDelta]||Object.values(state.players)[0];
      return {countries:player?{[player.countryCode]:state.countries[player.countryCode]}:{}};
    }
    return {events:state.events.slice(0,20),notifications:state.notifications.slice(0,20)};
  }

  chat(client,m){
    if(!client.roomId) throw new Error("Join a room first");
    const state=this.store.load(client.roomId);
    const message={id:id(),at:state.clock.date,playerId:client.playerId,text:String(m.text||"").trim().slice(0,500)};
    if(!message.text) throw new Error("Empty message");
    state.chat.push(message);state.chat=state.chat.slice(-200);this.store.save(state);
    this.broadcast(client.roomId,{type:"NOTIFICATION",notification:{kind:"CHAT",...message}});
  }

  diplomacyRequest(client,m){
    if(!client.roomId||!client.playerId) throw new Error("Join a room first");
    const state=this.store.load(client.roomId);
    const from=state.players[client.playerId];const target=state.countries[String(m.targetCountry||"").toUpperCase()];
    if(!from||!target) throw new Error("Invalid diplomacy target");
    if(target.code===from.countryCode) throw new Error("Cannot target your own country");
    if(!state.rules.allowHumanDiplomacy) throw new Error("Human diplomacy is disabled");
    const request={id:id(),fromCountry:from.countryCode,toCountry:target.code,status:"pending",createdAt:state.clock.date,expiresAt:addDays(state.clock.date,10),message:String(m.message||"Diplomatic proposal").slice(0,500)};
    state.diplomacyRequests.push(request);this.store.save(state);
    this.broadcast(client.roomId,{type:"DIPLOMACY_REQUEST",request});
  }

  diplomacyResponse(client,m){
    const state=this.store.load(client.roomId);
    const request=state.diplomacyRequests.find(r=>r.id===m.requestId);
    if(!request||request.status!=="pending") throw new Error("Diplomacy request unavailable");
    const player=state.players[client.playerId];
    if(!player||player.countryCode!==request.toCountry) throw new Error("Only the recipient can answer");
    if(m.accepted!==true&&m.accepted!==false) throw new Error("Invalid diplomacy response");
    request.status=m.accepted?"accepted":"rejected";request.resolvedAt=state.clock.date;
    state.notifications.unshift({id:id(),at:state.clock.date,kind:"DIPLOMACY_RESPONSE",message:`${request.fromCountry} diplomatic proposal ${request.status}`,countryCode:player.countryCode});
    this.store.save(state);this.broadcast(client.roomId,{type:"DIPLOMACY_RESPONSE",request});
  }

  broadcast(roomId,message,except=null){
    for(const client of this.clients.values()) if(client.roomId===roomId&&client!==except) json(client.socket,message);
  }

  disconnect(client){
    if(!this.clients.delete(client.socket)) return;
    if(client.roomId&&client.playerId){
      const state=this.store.load(client.roomId);
      if(state?.players[client.playerId]){state.players[client.playerId].connected=false;state.players[client.playerId].disconnectedAt=Date.now();this.store.save(state);}
      this.broadcast(client.roomId,{type:"PLAYER_LEFT",playerId:client.playerId});
    }
  }

  tickBroadcast(){
    for(const [roomId,state] of this.store.rooms){
      this.store.step(roomId);
      const now=Date.now();
      if(!state.__lastTimeBroadcast||now-state.__lastTimeBroadcast>=1000){
        state.__lastTimeBroadcast=now;
        for(const client of this.clients.values()) if(client.roomId===roomId) json(client.socket,{type:"TIME_UPDATE",clock:state.clock});
      }
      if(!state.__lastWorldBroadcast||now-state.__lastWorldBroadcast>=2000){
        state.__lastWorldBroadcast=now;
        for(const client of this.clients.values()){
          if(client.roomId!==roomId) continue;
          const player=state.players[client.playerId];
          const ownCountry=player?.countryCode?{[player.countryCode]:state.countries[player.countryCode]}:{};
          json(client.socket,{type:"WORLD_UPDATE",revision:state.sequence,events:state.events.slice(0,12),notifications:state.notifications.slice(0,12),countries:ownCountry});
        }
      }
      const seen=state.__broadcastNotificationIds||(state.__broadcastNotificationIds=new Set());
      for(const notification of (state.notifications||[]).slice(0,20)){
        if(seen.has(notification.id)) continue;
        seen.add(notification.id);
        const type=notification.kind==="EVENT_CREATED"?"EVENT_CREATED":notification.kind==="EVENT_RESOLVED"?"EVENT_RESOLVED":notification.kind==="DIPLOMACY_REQUEST"?"DIPLOMACY_REQUEST":notification.kind==="DIPLOMACY_RESPONSE"?"DIPLOMACY_RESPONSE":"NOTIFICATION";
        this.broadcast(roomId,{type,notification});
      }
    }
  }
}

export const attachRealtimeMultiplayer=(server,options)=>new RealtimeMultiplayer(server,options);
