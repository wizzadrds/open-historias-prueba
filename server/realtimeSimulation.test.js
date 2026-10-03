import test from "node:test";
import assert from "node:assert/strict";
import { buildRealtimeCountryDefinitions, createInitialRealtimeState, SimulationClock, tickSimulation, command, addPlayer, resolveRealtimeCountryCode, SPEEDS } from "./realtimeSimulation.js";

test("simulation clock is server authoritative and speed is bounded",()=>{
  const clock=new SimulationClock({date:"1920-01-01",speed:1,paused:false,lastWallClockMs:0,accumulatorMs:0});
  let days=0;
  clock.advanceWallClock(5000,(n)=>{days+=n;});
  assert.equal(days,1);
  clock.setSpeed(8);
  clock.advanceWallClock(10000,(n)=>{days+=n;});
  assert.equal(days,9);
  assert.throws(()=>clock.setSpeed(3),/Invalid simulation speed/);
  assert.deepEqual(SPEEDS,[0,0.5,1,2,4,8]);
});

test("world advances continuously and offline catch-up remains deterministic",()=>{
  const a=createInitialRealtimeState({id:"a",createdAt:0});
  const b=createInitialRealtimeState({id:"b",createdAt:0});
  a.clock.lastWallClockMs=0;b.clock.lastWallClockMs=0;
  const ca=new SimulationClock(a.clock);const cb=new SimulationClock(b.clock);
  ca.advanceWallClock(5000,n=>tickSimulation(a,n));
  cb.advanceWallClock(10000,n=>tickSimulation(b,n));
  assert.equal(a.clock.date,"1920-01-02");
  assert.equal(b.clock.date,"1920-01-03");
  assert.ok(b.stats.daysSimulated>a.stats.daysSimulated);
});

test("building and research are real state changes",()=>{
  const s=createInitialRealtimeState({id:"build"});
  addPlayer(s,{playerId:"player01",name:"P",countryCode:"GBR",host:true});
  const c=s.countries.GBR;
  const money=c.money;
  command(s,"player01","BUILD",{type:"factory",level:1,regionId:"london"});
  assert.equal(c.constructionQueue.length,1);
  assert.ok(c.money<money);
  c.researchPoints=100;
  command(s,"player01","RESEARCH",{techId:"assembly"});
  assert.equal(c.research.active.techId,"assembly");
  tickSimulation(s,130);
  assert.ok(c.buildings.some(b=>b.type==="factory"));
  assert.ok(c.research.completed.includes("assembly"));
});

test("events expire and auto-resolve without pausing simulation",()=>{
  const s=createInitialRealtimeState({id:"events"});
  addPlayer(s,{playerId:"player02",name:"P",countryCode:"GBR",host:true});
  command(s,"player02","ACTION",{type:"pandemic"});
  const event=s.events[0];
  assert.equal(event.status,"pending");
  const before=s.clock.date;
  tickSimulation(s,20);
  assert.notEqual(s.clock.date,before);
  assert.equal(s.events[0].status,"resolved");
  assert.equal(s.events[0].autoResolved,true);
});

test("units consume simulation time and ownership is enforced",()=>{
  const s=createInitialRealtimeState({id:"units"});
  addPlayer(s,{playerId:"player03",name:"P",countryCode:"GBR",host:true});
  const unit=s.countries.GBR.units[0];
  command(s,"player03","MOVE_UNIT",{unitId:unit.id,x:20,y:30});
  assert.deepEqual(unit.destination,{x:20,y:30});
  assert.throws(()=>command(s,"player03","MOVE_UNIT",{unitId:s.countries.FRA.units[0].id,x:1,y:1}),/not owned/);
});

test("host-only time controls and event choices are authoritative",()=>{
  const s=createInitialRealtimeState({id:"security"});
  addPlayer(s,{playerId:"player04",name:"Host",countryCode:"GBR",host:true});
  addPlayer(s,{playerId:"player05",name:"Guest",countryCode:"FRA"});
  assert.throws(()=>command(s,"player05","SET_SPEED",{speed:8}),/Only the host/);
  command(s,"player04","SET_SPEED",{speed:4});
  assert.equal(s.clock.speed,4);
  command(s,"player04","ACTION",{type:"food_crisis"});
  const e=s.events[0];
  assert.throws(()=>command(s,"player05","EVENT_CHOICE",{eventId:e.id,choiceId:"subsidize"}),/Event not available/);
});

test("realtime uses the active game's polity roster instead of a hardcoded country list",()=>{
  const world={
    regionOwnershipOverrides:{
      "1":"United States",
      "2":"Spain",
      "3":"Canada",
      "4":"España",
    },
    polityOverrides:{
      "United States":{name:"United States"},
      "Spain":{name:"Spain"},
      "Canada":{name:"Canada"},
    },
  };
  const definitions=buildRealtimeCountryDefinitions(world);
  const state=createInitialRealtimeState({id:"real-world",world,countryDefinitions:definitions});
  assert.ok(state.countries["United States"]);
  assert.ok(state.countries.Spain);
  assert.ok(state.countries.Canada);
  assert.equal(resolveRealtimeCountryCode("Spain",state.countries),"Spain");
  assert.equal(resolveRealtimeCountryCode("España",state.countries),"España");
  assert.equal(Object.keys(state.countries).length,4);
});


test("realtime room state keeps the real campaign timeline and world",()=>{
  const world={regionOwnershipOverrides:{"1":"United States","2":"Spain"}};
  const game={country:"United States",startDate:"2016-01-01",gameDate:"2016-01-01"};
  const state=createInitialRealtimeState({id:"campaign",gameId:"game-1",startDate:game.gameDate,world,gameData:game});
  assert.equal(state.clock.date,"2016-01-01");
  assert.equal(state.game.gameDate,"2016-01-01");
  assert.deepEqual(state.world,world);
  tickSimulation(state,1);
  assert.equal(state.clock.date,"2016-01-02");
  assert.equal(state.game.gameDate,"2016-01-02");
});
