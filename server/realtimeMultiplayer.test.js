import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeMultiplayer } from "./realtimeMultiplayer.js";

class FakeServer {
  constructor(){this.handlers={};}
  on(name,handler){this.handlers[name]=handler;}
}
class MemoryStore {
  constructor(){this.rooms=new Map();}
  create(options){const state={id:options.id||"room-1",mode:options.mode||"multi",players:{},countries:{GBR:{code:"GBR"},FRA:{code:"FRA"}},rules:{maxPlayers:8,allowHumanDiplomacy:true},rooms:{hostPlayerId:null},events:[],notifications:[],diplomacyRequests:[],clock:{date:"1920-01-01",speed:1,paused:false},sequence:0};this.rooms.set(state.id,state);return state;}
  load(id){return this.rooms.get(id)||null;}
  save(state){this.rooms.set(state.id,state);}
  step(){return 0;}
}

test("multiplayer room creation and country ownership are server-side",()=>{
 const server=new FakeServer(),store=new MemoryStore(),rt=new RealtimeMultiplayer(server,{store,gameLoader:()=>({game:{id:"game-1",name:"Test Game",scenarioId:"default"},scenario:{id:"default"},data:{game:{gameDate:"1920-01-01"}}})});
 const client={socket:{write(){}},commands:[]};
 rt.message(client,{type:"CREATE_ROOM",gameId:"game-1",mode:"multi",playerId:"player01",playerName:"Host",countryCode:"GBR"});
 assert.equal(client.roomId,"room-1");
 const state=store.load("room-1");
 assert.equal(state.rooms.hostPlayerId,"player01");
 assert.equal(state.players.player01.countryCode,"GBR");
 const guest={socket:{write(){}},commands:[]};
 rt.message(guest,{type:"JOIN_ROOM",roomId:"room-1",playerId:"player02",playerName:"Guest",countryCode:"FRA"});
 assert.equal(state.players.player02.countryCode,"FRA");
 assert.throws(()=>rt.message({socket:{write(){}},commands:[]},{type:"JOIN_ROOM",roomId:"room-1",playerId:"player03",playerName:"Cheat",countryCode:"GBR"}),/Country already occupied/);
});

test("reconnect can reuse a disconnected identity without duplicating a country",()=>{
 const server=new FakeServer(),store=new MemoryStore(),rt=new RealtimeMultiplayer(server,{store,gameLoader:()=>({game:{id:"game-1",name:"Test Game",scenarioId:"default"},scenario:{id:"default"},data:{game:{gameDate:"1920-01-01"}}})});
 const first={socket:{write(){}},commands:[]};
 rt.message(first,{type:"CREATE_ROOM",gameId:"game-1",mode:"multi",playerId:"player11",playerName:"Host",countryCode:"GBR"});
 const state=store.load(first.roomId);
 state.players.player11.connected=false;
 const reconnect={socket:{write(){}},commands:[]};
 rt.message(reconnect,{type:"JOIN_ROOM",roomId:first.roomId,playerId:"player11",playerName:"Host",countryCode:"GBR"});
 assert.equal(Object.keys(state.players).length,1);
 assert.equal(state.players.player11.connected,true);
});

test("foreign clients cannot use a player's command channel to change time",()=>{
 const server=new FakeServer(),store=new MemoryStore(),rt=new RealtimeMultiplayer(server,{store,gameLoader:()=>({game:{id:"game-1",name:"Test Game",scenarioId:"default"},scenario:{id:"default"},data:{game:{gameDate:"1920-01-01"}}})});
 const host={socket:{write(){}},commands:[]};
 rt.message(host,{type:"CREATE_ROOM",gameId:"game-1",mode:"multi",playerId:"player21",playerName:"Host",countryCode:"GBR"});
 const guest={socket:{write(){}},commands:[]};
 rt.message(guest,{type:"JOIN_ROOM",roomId:host.roomId,playerId:"player22",playerName:"Guest",countryCode:"FRA"});
 assert.throws(()=>rt.message(guest,{type:"COMMAND",action:"SET_SPEED",payload:{speed:8}}),/Only the host/);
});


test("human diplomacy creates an expiring request and only the recipient can answer",()=>{
 const server=new FakeServer(),store=new MemoryStore(),rt=new RealtimeMultiplayer(server,{store,gameLoader:()=>({game:{id:"game-1",name:"Test Game",scenarioId:"default"},scenario:{id:"default"},data:{game:{gameDate:"1920-01-01"}}})});
 const host={socket:{write(){}},commands:[]};
 rt.message(host,{type:"CREATE_ROOM",gameId:"game-1",mode:"multi",playerId:"player31",playerName:"Host",countryCode:"GBR"});
 const guest={socket:{write(){}},commands:[]};
 rt.message(guest,{type:"JOIN_ROOM",roomId:host.roomId,playerId:"player32",playerName:"Guest",countryCode:"FRA"});
 rt.message(host,{type:"DIPLOMACY_REQUEST",targetCountry:"FRA",message:"Open talks"});
 const state=store.load(host.roomId);
 assert.equal(state.diplomacyRequests.length,1);
 assert.equal(state.diplomacyRequests[0].status,"pending");
 assert.equal(state.diplomacyRequests[0].expiresAt,"1920-01-11");
 assert.throws(()=>rt.message(host,{type:"DIPLOMACY_RESPONSE",requestId:state.diplomacyRequests[0].id,accepted:true}),/Only the recipient/);
 rt.message(guest,{type:"DIPLOMACY_RESPONSE",requestId:state.diplomacyRequests[0].id,accepted:true});
 assert.equal(state.diplomacyRequests[0].status,"accepted");
});
