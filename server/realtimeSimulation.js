import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";

export const REALTIME_START_DATE = "1920-01-01";
export const SPEEDS = Object.freeze([0, 0.5, 1, 2, 4, 8]);
export const DAY_MS_AT_X1 = 5000;
const MAX_CATCHUP_DAYS = 3650;
const SAVE_INTERVAL_MS = 5000;

const COUNTRY_SEED = [
  ["GBR","United Kingdom",46_000_000,12000,9000,7000,9000,120],
  ["FRA","France",39_000_000,10000,7500,6500,8000,100],
  ["DEU","Germany",60_000_000,11000,10000,9000,10000,140],
  ["ITA","Italy",38_000_000,7000,6000,5000,6000,90],
  ["ESP","Spain",21_000_000,5500,5000,3500,4500,65],
  ["USA","United States",106_000_000,18000,15000,14000,16000,180],
  ["JPN","Japan",56_000_000,9000,8500,7500,8000,120],
  ["SOV","Soviet Union",135_000_000,8000,11000,9000,11000,160],
];

const BUILDINGS = Object.freeze({
  factory: { label:"Industrial Plant", days:90, cost:{money:1200,rawMaterials:800,industrialCapacity:20}, modifiers:{industrialCapacity:0.08} },
  farm: { label:"Agricultural Estate", days:70, cost:{money:800,rawMaterials:300,industrialCapacity:12}, modifiers:{food:0.10} },
  power: { label:"Power Station", days:110, cost:{money:1400,rawMaterials:900,industrialCapacity:25}, modifiers:{energy:0.12} },
  university: { label:"University", days:150, cost:{money:1600,rawMaterials:500,industrialCapacity:18}, modifiers:{research:0.10} },
  barracks: { label:"Barracks", days:80, cost:{money:900,rawMaterials:600,industrialCapacity:16}, modifiers:{troops:0.08} },
});

const TECHNOLOGIES = Object.freeze([
  {id:"assembly",name:"Assembly Lines",days:120,cost:100,modifiers:{industrialCapacity:0.12}},
  {id:"public_health",name:"Public Health",days:140,cost:110,modifiers:{populationGrowth:0.10,food:0.04}},
  {id:"motorization",name:"Motorization",days:160,cost:125,modifiers:{armySpeed:0.20,armyPower:0.08}},
  {id:"electrification",name:"National Electrification",days:180,cost:140,modifiers:{energy:0.18,industrialCapacity:0.06}},
  {id:"combined_arms",name:"Combined Arms",days:220,cost:170,modifiers:{armyPower:0.18}},
  {id:"logistics",name:"Modern Logistics",days:200,cost:160,modifiers:{armySpeed:0.15,food:0.06}},
]);

const UNIT_TYPES = Object.freeze({
  infantry:{speed:1,power:1,cost:{money:400,food:80,rawMaterials:150}},
  armor:{speed:2,power:2.4,cost:{money:900,food:100,rawMaterials:500}},
  artillery:{speed:1.2,power:1.8,cost:{money:700,food:70,rawMaterials:350}},
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
const dateValue = (date) => Date.parse(`${date}T00:00:00Z`);
const dateFromValue = (value) => new Date(value).toISOString().slice(0,10);
const addDays = (date, days) => dateFromValue(dateValue(date) + Math.round(days) * 86400000);
const daysBetween = (a,b) => Math.max(0, Math.floor((dateValue(b)-dateValue(a))/86400000));

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

const roomDir = path.join(DATA_DIR, "realtime");
const roomPath = (id) => path.join(roomDir, `${id}.json`);

const ensureDir = () => fs.mkdirSync(roomDir,{recursive:true});
const writeJsonAtomic = (file,value) => {
  ensureDir();
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value,null,2));
  fs.renameSync(tmp,file);
};

const makeCountry = ([code,name,population,money,food,energy,rawMaterials,industrialCapacity]) => ({
  code,name,population,money,food,energy,rawMaterials,industrialCapacity,
  researchPoints:100,research:{completed:[],active:null},buildings:[],
  constructionQueue:[],productionQueue:[],units:[],
  modifiers:{industrialCapacity:0,food:0,energy:0,research:0,populationGrowth:0,armySpeed:0,armyPower:0,troops:0},
  diplomacy:{relations:{},pending:[]},
});

const defaultCountries = () => Object.fromEntries(COUNTRY_SEED.map(seed => [seed[0],makeCountry(seed)]));

const nextId = (prefix, state) => {
  state.sequence += 1;
  return `${prefix}-${state.sequence.toString(36)}`;
};

const countryForPlayer = (state,playerId) => {
  const player = state.players[playerId];
  return player?.countryCode ? state.countries[player.countryCode] : null;
};

const spend = (country,cost) => {
  for (const [key,value] of Object.entries(cost || {})) {
    if ((country[key] ?? 0) < value) return false;
  }
  for (const [key,value] of Object.entries(cost || {})) country[key] -= value;
  return true;
};

const addModifier = (country, modifiers, factor=1) => {
  for (const [key,value] of Object.entries(modifiers || {})) country.modifiers[key] = (country.modifiers[key] || 0) + value * factor;
};

const effective = (country,key,base) => base * (1 + (country.modifiers[key] || 0));

export function createInitialRealtimeState({id,mode="single",name="1920 Campaign",seed=19200101,createdAt=Date.now()}={}) {
  const state = {
    version:1,id,mode,name,seed,sequence:0,createdAt,lastSavedAt:createdAt,
    clock:{date:REALTIME_START_DATE,speed:1,paused:false,lastWallClockMs:createdAt,accumulatorMs:0},
    countries:defaultCountries(),
    players:{},rooms:{hostPlayerId:null},
    events:[],notifications:[],chat:[],diplomacyRequests:[],rules:{
      startDate:REALTIME_START_DATE,allowHumanDiplomacy:true,aiCountries:true,maxPlayers:8,
    },
    stats:{daysSimulated:0},
  };
  for (const country of Object.values(state.countries)) {
    country.units.push({id:nextId("unit",state),name:"1st Infantry Division",type:"infantry",strength:100,organization:100,position:{x:0,y:0},destination:null,eta:null});
  }
  return state;
}

export function sanitizeSnapshot(state) {
  const snapshot=clone(state);
  snapshot.clock.accumulatorMs=0;
  snapshot.clock.lastWallClockMs=0;
  return snapshot;
}

export class SimulationClock {
  constructor(clock) { this.clock=clock; }
  setSpeed(speed) {
    const next=Number(speed);
    if (!SPEEDS.includes(next)) throw new Error("Invalid simulation speed");
    this.clock.speed=next;
    this.clock.paused=next===0;
  }
  pause(){this.clock.speed=0;this.clock.paused=true;}
  resume(speed=1){this.setSpeed(speed || 1);}
  advanceWallClock(nowMs, onDays) {
    const now=Number(nowMs);
    const previous=this.clock.lastWallClockMs == null ? now : this.clock.lastWallClockMs;
    let elapsed=Math.max(0,now-previous);
    this.clock.lastWallClockMs=now;
    if(this.clock.paused || this.clock.speed===0) return 0;
    elapsed=Math.min(elapsed,MAX_CATCHUP_DAYS*DAY_MS_AT_X1);
    this.clock.accumulatorMs += elapsed*this.clock.speed;
    const wholeDays=Math.floor(this.clock.accumulatorMs/DAY_MS_AT_X1);
    this.clock.accumulatorMs -= wholeDays*DAY_MS_AT_X1;
    if(wholeDays>0) onDays(wholeDays);
    return wholeDays;
  }
}

function createEvent(state,countryCode,type,title,category,priority,choices,effects,expiresInDays=12) {
  const createdAt=state.clock.date;
  const event={id:nextId("event",state),countryCode,type,title,category,priority,
    createdAt,expiresAt:addDays(createdAt,expiresInDays),choices:choices||[],effects:effects||{},status:"pending"};
  state.events.unshift(event);
  state.notifications.unshift({id:nextId("notification",state),at:createdAt,kind:"EVENT_CREATED",message:title,countryCode});
  return event;
}

function resolveEvent(state,event,choiceId,auto=false) {
  if(event.status!=="pending") throw new Error("Event is no longer pending");
  const choice=event.choices.find(c=>c.id===choiceId) || event.choices[0];
  if(!choice) throw new Error("Event has no valid choice");
  const country=state.countries[event.countryCode];
  for(const [key,value] of Object.entries(choice.effects||{})) {
    if(["money","food","energy","rawMaterials","population","industrialCapacity","researchPoints"].includes(key)) {
      country[key]=Math.max(0,(country[key]||0)+value);
    }
  }
  addModifier(country,choice.modifiers);
  event.status="resolved";event.resolvedAt=state.clock.date;event.resolution=choice.id;event.autoResolved=auto;
  state.notifications.unshift({id:nextId("notification",state),at:state.clock.date,kind:"EVENT_RESOLVED",message:`${event.title}: ${choice.label}`,countryCode:event.countryCode});
}

function maybeGenerateEvents(state,country,random) {
  if(random()>.018) return;
  const roll=random();
  if(roll<.25) createEvent(state,country.code,"food_crisis","Food prices surge after a poor harvest","economy",3,
    [{id:"ration",label:"Introduce rationing",effects:{food:-100},modifiers:{populationGrowth:-0.03}},
     {id:"subsidize",label:"Subsidize imports",effects:{money:-500,food:350}}]);
  else if(roll<.5) createEvent(state,country.code,"strike","Industrial workers call a national strike","social",2,
    [{id:"negotiate",label:"Negotiate",effects:{money:-350},modifiers:{industrialCapacity:-0.03}},
     {id:"crackdown",label:"Crack down",effects:{population:-25000},modifiers:{industrialCapacity:0.04}}]);
  else if(roll<.75) createEvent(state,country.code,"energy_crisis","Coal shortages threaten the power grid","energy",2,
    [{id:"imports",label:"Buy foreign coal",effects:{money:-450,energy:300}},
     {id:"ration",label:"Ration electricity",effects:{energy:-120},modifiers:{industrialCapacity:-0.04}}]);
  else createEvent(state,country.code,"pandemic","A severe influenza wave spreads through major cities","health",4,
    [{id:"public_health",label:"Fund public health",effects:{money:-650,population:-120000},modifiers:{populationGrowth:0.05}},
     {id:"ignore",label:"Keep the economy open",effects:{population:-220000},modifiers:{populationGrowth:-0.08}}]);
}

function progressCountry(state,country,days) {
  const industrial = effective(country,"industrialCapacity",country.industrialCapacity);
  country.money += Math.max(1,industrial*0.035)*days;
  country.food += Math.max(1,effective(country,"food",country.food*0.0007))*days;
  country.energy += Math.max(1,effective(country,"energy",country.energy*0.0006))*days;
  country.rawMaterials += Math.max(1,country.industrialCapacity*0.04)*days;
  const growth = Math.max(-0.01,0.006+(country.modifiers.populationGrowth||0))*days/365;
  country.population=Math.max(100000,Math.round(country.population*(1+growth)));

  for(const item of country.constructionQueue) item.remainingDays-=days;
  const completed=country.constructionQueue.filter(x=>x.remainingDays<=0);
  country.constructionQueue=country.constructionQueue.filter(x=>x.remainingDays>0);
  for(const item of completed){
    const building={id:item.id,type:item.type,level:item.level,health:100,regionId:item.regionId,completedAt:state.clock.date};
    country.buildings.push(building);
    addModifier(country,BUILDINGS[item.type].modifiers);
    state.notifications.unshift({id:nextId("notification",state),at:state.clock.date,kind:"BUILDING_COMPLETE",message:`${BUILDINGS[item.type].label} completed`,countryCode:country.code});
  }

  country.researchPoints += days * (1 + (country.modifiers.research || 0));

  if(country.research.active){
    const tech=TECHNOLOGIES.find(t=>t.id===country.research.active.techId);
    country.research.active.remainingDays-=days*(1+(country.modifiers.research||0));
    if(country.research.active.remainingDays<=0){
      country.research.completed.push(tech.id);
      addModifier(country,tech.modifiers);
      state.notifications.unshift({id:nextId("notification",state),at:state.clock.date,kind:"RESEARCH_COMPLETE",message:`${tech.name} researched`,countryCode:country.code});
      country.research.active=null;
    }
  }

  for(const unit of country.units){
    if(!unit.destination) continue;
    const remaining=unit.eta?Math.max(0,daysBetween(state.clock.date,unit.eta)):1;
    if(remaining<=0){unit.position={...unit.destination};unit.destination=null;unit.eta=null;continue;}
    const speed=effective(country,"armySpeed",UNIT_TYPES[unit.type]?.speed||1);
    const travelDays=Math.max(1,Math.ceil(10/speed));
    unit.eta=unit.eta||addDays(state.clock.date,travelDays);
    if(daysBetween(state.clock.date,unit.eta)<=0){unit.position={...unit.destination};unit.destination=null;unit.eta=null;}
  }
}

function aiStep(state,country,random) {
  const active=country.research.active;
  if(!active){
    const tech=TECHNOLOGIES.find(t=>!country.research.completed.includes(t.id));
    if(tech && country.researchPoints>=tech.cost) country.research.active={techId:tech.id,remainingDays:tech.days};
  }
  if(country.constructionQueue.length<2){
    const types=Object.keys(BUILDINGS);
    const type=types[Math.floor(random()*types.length)];
    const def=BUILDINGS[type];
    if(spend(country,def.cost)) country.constructionQueue.push({id:nextId("build",state),type,level:1,regionId:null,remainingDays:def.days,queuedAt:state.clock.date});
  }
  if(random()<0.15 && country.units[0]){
    const unit=country.units[0];
    unit.destination={x:Math.round(random()*1000)/10,y:Math.round(random()*500)/10};
    unit.eta=addDays(state.clock.date,Math.max(2,Math.round(8/(UNIT_TYPES[unit.type]?.speed||1))));
  }
  if(random()<0.04 && state.rules.allowHumanDiplomacy){
    state.notifications.unshift({id:nextId("notification",state),at:state.clock.date,kind:"DIPLOMACY_REQUEST",message:`${country.name} requests diplomatic talks`,countryCode:country.code});
  }
}

export function tickSimulation(state,days) {
  if(days<=0) return {days:0,changed:false};
  const random=rng((state.seed + state.stats.daysSimulated + days) >>> 0);
  state.clock.date=addDays(state.clock.date,days);
  state.stats.daysSimulated += days;
  for(const country of Object.values(state.countries)){
    progressCountry(state,country,days);
    maybeGenerateEvents(state,country,random);
    if(!state.playersByCountry?.[country.code]) aiStep(state,country,random);
  }
  for(const event of state.events){
    if(event.status==="pending" && dateValue(event.expiresAt)<=dateValue(state.clock.date)){
      resolveEvent(state,event,event.choices[0]?.id,true);
    }
  }
  state.events=state.events.filter(e=>e.status==="pending" || daysBetween(e.resolvedAt,state.clock.date)<=90);
  return {days,changed:true};
}

export function command(state,playerId,action,payload={}) {
  const player=state.players[playerId];
  if(!player) throw new Error("Unknown player");
  const country=countryForPlayer(state,playerId);
  if(!country) throw new Error("Player has no country");
  switch(action){
    case "SET_SPEED":
      if(state.rooms.hostPlayerId!==playerId) throw new Error("Only the host may change simulation speed");
      new SimulationClock(state.clock).setSpeed(payload.speed);
      break;
    case "PAUSE":
      if(state.rooms.hostPlayerId!==playerId) throw new Error("Only the host may pause");
      new SimulationClock(state.clock).pause();
      break;
    case "RESUME":
      if(state.rooms.hostPlayerId!==playerId) throw new Error("Only the host may resume");
      new SimulationClock(state.clock).resume(payload.speed || 1);
      break;
    case "BUILD": {
      const type=String(payload.type||"");
      const def=BUILDINGS[type];
      if(!def) throw new Error("Unknown building");
      const level=clamp(Number(payload.level||1),1,10);
      if(!spend(country,def.cost)) throw new Error("Insufficient resources");
      country.constructionQueue.push({id:nextId("build",state),type,level,regionId:payload.regionId||null,remainingDays:def.days*level,queuedAt:state.clock.date});
      break;
    }
    case "RESEARCH": {
      const tech=TECHNOLOGIES.find(t=>t.id===payload.techId);
      if(!tech) throw new Error("Unknown technology");
      if(country.research.completed.includes(tech.id)) throw new Error("Technology already researched");
      if(country.research.active) throw new Error("Research already active");
      if(country.researchPoints<tech.cost) throw new Error("Insufficient research points");
      country.researchPoints-=tech.cost;
      country.research.active={techId:tech.id,remainingDays:tech.days,startedAt:state.clock.date};
      break;
    }
    case "MOVE_UNIT": {
      const unit=country.units.find(u=>u.id===payload.unitId);
      if(!unit) throw new Error("Unit not owned by player");
      const x=Number(payload.x),y=Number(payload.y);
      if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>180||Math.abs(y)>90) throw new Error("Invalid destination");
      unit.destination={x,y};
      unit.eta=addDays(state.clock.date,Math.max(1,Math.round(10/effective(country,"armySpeed",UNIT_TYPES[unit.type]?.speed||1))));
      break;
    }
    case "EVENT_CHOICE": {
      const event=state.events.find(e=>e.id===payload.eventId && e.countryCode===country.code);
      if(!event) throw new Error("Event not available");
      resolveEvent(state,event,String(payload.choiceId),false);
      break;
    }
    case "ACTION": {
      const types={pandemic:["pandemic","A health emergency requires a national response"],strike:["strike","Workers threaten a national strike"],food_crisis:["food_crisis","Food supplies are collapsing"],energy_crisis:["energy_crisis","The national grid is under pressure"]};
      const [type,title]=types[payload.type]||[];
      if(!type) throw new Error("Unknown internal action");
      const choices=type==="pandemic"
        ? [{id:"health",label:"Emergency health program",effects:{money:-500,population:-50000},modifiers:{populationGrowth:0.04}},{id:"minimal",label:"Minimal intervention",effects:{population:-90000}}]
        : [{id:"fund",label:"Fund a response",effects:{money:-400},modifiers:{industrialCapacity:0.03}},{id:"ignore",label:"Do nothing",modifiers:{industrialCapacity:-0.05}}];
      createEvent(state,country.code,type,title,"domestic",3,choices);
      break;
    }
    default: throw new Error("Unknown realtime action");
  }
  state.lastMutationAt=Date.now();
  return {changed:true};
}

export function normalizePlayerId(value){
  return typeof value==="string" && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : null;
}

export function addPlayer(state,{playerId,name,countryCode,host=false}) {
  if(!normalizePlayerId(playerId)) throw new Error("Invalid player id");
  if(state.players[playerId]){
    if(state.players[playerId].connected) throw new Error("Player is already connected");
    state.players[playerId].connected=true;
    state.players[playerId].reconnectedAt=Date.now();
    state.playersByCountry=Object.fromEntries(Object.values(state.players).map(p=>[p.countryCode,p.id]));
    return state.players[playerId];
  }
  if(Object.keys(state.players).length>=state.rules.maxPlayers) throw new Error("Room is full");
  const code=String(countryCode||"").toUpperCase();
  if(!state.countries[code]) throw new Error("Unknown country");
  if(Object.values(state.players).some(p=>p.countryCode===code)) throw new Error("Country already occupied");
  const player={id:playerId,name:String(name||"Player").slice(0,40),countryCode:code,connected:true,joinedAt:Date.now(),host:Boolean(host)};
  state.players[playerId]=player;
  state.playersByCountry=Object.fromEntries(Object.values(state.players).map(p=>[p.countryCode,p.id]));
  if(host) state.rooms.hostPlayerId=playerId;
  return player;
}

export function removePlayer(state,playerId){
  if(!state.players[playerId]) return;
  state.players[playerId].connected=false;
  state.players[playerId].disconnectedAt=Date.now();
}

export class RealtimeRoomStore {
  constructor(){this.rooms=new Map();this.timers=new Map();}
  load(roomId){
    if(this.rooms.has(roomId)) return this.rooms.get(roomId);
    ensureDir();
    let state=null;
    try{state=JSON.parse(fs.readFileSync(roomPath(roomId),"utf8"));}catch{ /* missing room */ }
    if(!state) return null;
    state.playersByCountry=Object.fromEntries(Object.values(state.players||{}).map(p=>[p.countryCode,p.id]));
    this.rooms.set(roomId,state);
    this.start(roomId);
    return state;
  }
  create(options={}){
    const id=options.id || `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    const state=createInitialRealtimeState({...options,id});
    this.rooms.set(id,state);
    this.start(id);
    this.save(state);
    return state;
  }
  start(roomId){
    if(this.timers.has(roomId)) return;
    const timer=setInterval(()=>this.step(roomId),250);
    timer.unref?.();
    this.timers.set(roomId,timer);
  }
  step(roomId,now=Date.now()){
    const state=this.rooms.get(roomId); if(!state) return;
    const clock=new SimulationClock(state.clock);
    const days=clock.advanceWallClock(now,(count)=>tickSimulation(state,count));
    if(days || now-(state.lastSavedAt||0)>=SAVE_INTERVAL_MS) this.save(state);
    return days;
  }
  save(state){state.lastSavedAt=Date.now();writeJsonAtomic(roomPath(state.id),state);}
  close(roomId){const t=this.timers.get(roomId);if(t) clearInterval(t);this.timers.delete(roomId);const s=this.rooms.get(roomId);if(s)this.save(s);}
}

export const BUILDING_DEFINITIONS=BUILDINGS;
export const TECHNOLOGY_DEFINITIONS=TECHNOLOGIES;
export const UNIT_DEFINITIONS=UNIT_TYPES;
