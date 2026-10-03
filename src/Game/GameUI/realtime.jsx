import React,{Component,useCallback,useEffect,useMemo,useRef,useState} from "react";

const SPEEDS=[0,0.5,1,2,4,8];
const COUNTRIES=[
  ["GBR","United Kingdom","Europe"],["FRA","France","Europe"],["DEU","Germany","Europe"],
  ["ITA","Italy","Europe"],["ESP","Spain","Europe"],["USA","United States","Americas"],
  ["JPN","Japan","Asia"],["SOV","Soviet Union","Europe"]
];
const BUILDINGS=[
  ["factory","Industry","Industrial Plant","⚙"],["farm","Food","Agricultural Estate","▥"],
  ["power","Energy","Power Station","ϟ"],["university","Research","University","◇"],
  ["barracks","Military","Barracks","✦"]
];
const TECHS=[
  ["assembly","Assembly Lines","Industry"],["public_health","Public Health","Society"],
  ["motorization","Motorization","Military"],["electrification","National Electrification","Energy"],
  ["combined_arms","Combined Arms","Military"],["logistics","Modern Logistics","Military"]
];

const colors={
  ink:"#eef2f7",muted:"#8e9aaa",line:"rgba(255,255,255,.09)",
  panel:"rgba(10,14,20,.94)",panel2:"rgba(255,255,255,.045)",
  accent:"#d6b36a",green:"#72c59b",red:"#e77b7b",blue:"#7ca9df"
};
const css={
  root:{position:"fixed",inset:0,zIndex:10000,pointerEvents:"none",fontFamily:"Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",color:colors.ink},
  launcher:{position:"fixed",right:20,bottom:88,pointerEvents:"auto",border:"1px solid rgba(255,255,255,.15)",borderRadius:14,padding:"11px 15px",background:"rgba(10,14,20,.92)",color:colors.ink,boxShadow:"0 12px 40px rgba(0,0,0,.35)",cursor:"pointer"},
  shell:{position:"absolute",inset:"4.5rem 1rem 1rem 1rem",pointerEvents:"auto",display:"grid",gridTemplateRows:"auto 1fr",overflow:"hidden",border:"1px solid "+colors.line,borderRadius:22,background:colors.panel,boxShadow:"0 30px 100px rgba(0,0,0,.58)",backdropFilter:"blur(22px)"},
  top:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,padding:"16px 20px",borderBottom:"1px solid "+colors.line},
  nav:{display:"flex",gap:5,overflowX:"auto"},
  navBtn:{border:"0",background:"transparent",color:colors.muted,padding:"8px 11px",borderRadius:9,cursor:"pointer",whiteSpace:"nowrap"},
  main:{minHeight:0,display:"grid",gridTemplateColumns:"minmax(0,1fr) 290px"},
  content:{overflow:"auto",padding:20},
  rail:{borderLeft:"1px solid "+colors.line,overflow:"auto",padding:16,background:"rgba(0,0,0,.12)"},
  card:{border:"1px solid "+colors.line,borderRadius:15,padding:14,background:colors.panel2},
  button:{border:"1px solid rgba(255,255,255,.13)",background:"rgba(255,255,255,.055)",color:colors.ink,borderRadius:9,padding:"8px 11px",cursor:"pointer"},
  input:{width:"100%",boxSizing:"border-box",border:"1px solid rgba(255,255,255,.13)",background:"rgba(0,0,0,.22)",color:colors.ink,borderRadius:9,padding:"9px 10px",outline:"none"},
  label:{fontSize:11,color:colors.muted,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:".08em"},
};

const safeArray=(v)=>Array.isArray(v)?v.filter(Boolean):[];
const countryName=(code)=>COUNTRIES.find(x=>x[0]===code)?.[1]||code||"Unknown";
const fmt=(n)=>Number(n||0).toLocaleString("en-US",{maximumFractionDigits:0});
const wsUrl=()=>{const proto=location.protocol==="https:"?"wss":"ws";return proto+"://"+location.host+"/ws/realtime";};
const send=(socket,msg)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(msg));};

class RealtimeBoundary extends Component{
  constructor(p){super(p);this.state={failed:false};}
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error){console.error("Realtime hub error",error);}
  render(){return this.state.failed?<div style={{...css.root,pointerEvents:"none"}}/>:this.props.children;}
}

function Metric({label,value,sub,accent=false}){
 return <div style={{padding:"11px 12px",borderRadius:12,background:"rgba(255,255,255,.035)",border:"1px solid "+colors.line}}>
   <div style={{fontSize:10,color:colors.muted,textTransform:"uppercase",letterSpacing:".08em"}}>{label}</div>
   <div style={{fontSize:20,fontWeight:650,marginTop:3,color:accent?colors.accent:colors.ink}}>{value}</div>
   {sub&&<div style={{fontSize:11,color:colors.muted,marginTop:2}}>{sub}</div>}
 </div>;
}

function SectionTitle({eyebrow,title,children}){
 return <div style={{display:"flex",justifyContent:"space-between",alignItems:"end",gap:12,marginBottom:12}}>
   <div><div style={{fontSize:10,color:colors.accent,textTransform:"uppercase",letterSpacing:".13em"}}>{eyebrow}</div><h2 style={{margin:"3px 0 0",fontSize:21,fontWeight:650}}>{title}</h2></div>{children}
 </div>;
}

function Hub({room,setRoom,playerId,socket,roomId,playerName,country,command,error,setError}){
 const [tab,setTab]=useState("overview");
 const player=room?.players?.[playerId];
 const myCode=player?.countryCode||country;
 const nation=room?.countries?.[myCode];
 const events=safeArray(room?.events).filter(e=>e&&e.status==="pending"&&e.countryCode===myCode);
 const units=safeArray(nation?.units);
 const activeTech=nation?.research?.active;
 const players=Object.values(room?.players||{}).filter(Boolean);
 const notifications=safeArray(room?.notifications).slice(0,8);
 const pendingDip=safeArray(room?.diplomacyRequests).filter(r=>r&&r.status==="pending"&&r.toCountry===myCode);
 const isHost=room?.rooms?.hostPlayerId===playerId;
 const [chatText,setChatText]=useState("");
 const [target,setTarget]=useState(COUNTRIES.find(x=>x[0]!==myCode)?.[0]||"FRA");

 useEffect(()=>{if(!COUNTRIES.some(x=>x[0]===target&&x[0]!==myCode))setTarget(COUNTRIES.find(x=>x[0]!==myCode)?.[0]||"FRA");},[myCode,target]);

 const tabs=[["overview","Command"],["economy","Economy"],["military","Military"],["diplomacy","Diplomacy"],["events","Decisions"]];
 return <div style={css.root}>
   <div style={css.shell}>
     <header style={css.top}>
       <div style={{display:"flex",alignItems:"center",gap:13,minWidth:0}}>
         <div style={{width:40,height:40,borderRadius:11,display:"grid",placeItems:"center",background:"linear-gradient(135deg,#d6b36a,#6c5630)",color:"#17120a",fontWeight:900}}>OH</div>
         <div style={{minWidth:0}}><div style={{fontSize:10,color:colors.accent,textTransform:"uppercase",letterSpacing:".14em"}}>War Room · 1920</div><div style={{fontSize:18,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{countryName(myCode)} <span style={{color:colors.muted,fontWeight:400}}>· {room?.name||"Campaign"}</span></div></div>
       </div>
       <div style={{display:"flex",alignItems:"center",gap:9}}>
         <div style={{fontVariantNumeric:"tabular-nums",fontSize:17,fontWeight:650}}>{room?.clock?.date||"1920-01-01"}</div>
         <span style={{fontSize:11,color:room?.clock?.speed===0?colors.red:colors.green}}>● {room?.clock?.speed===0?"Paused":"Live x"+room?.clock?.speed}</span>
         <button style={css.button} onClick={()=>setRoom(null)}>Exit</button>
       </div>
     </header>
     <div style={css.main}>
       <main style={css.content}>
         <div style={css.nav}>{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{...css.navBtn,background:tab===id?"rgba(214,179,106,.13)":"transparent",color:tab===id?colors.ink:colors.muted}}>{label}</button>)}</div>
         {tab==="overview"&&<Overview nation={nation} events={events} units={units} activeTech={activeTech} command={command} isHost={isHost} clock={room?.clock}/>}
         {tab==="economy"&&<Economy nation={nation} command={command}/>}
         {tab==="military"&&<Military nation={nation} units={units} command={command}/>}
         {tab==="diplomacy"&&<Diplomacy myCode={myCode} players={players} target={target} setTarget={setTarget} pending={pendingDip} socket={socket} room={room}/>}
         {tab==="events"&&<Events events={events} command={command}/>}
         {error&&<div style={{marginTop:14,padding:12,borderRadius:12,border:"1px solid rgba(231,123,123,.25)",background:"rgba(231,123,123,.08)",color:"#f0b0b0"}}>{error}</div>}
       </main>
       <aside style={css.rail}>
         <div style={{...css.card,marginBottom:12}}>
           <div style={{fontSize:10,color:colors.muted,textTransform:"uppercase",letterSpacing:".1em"}}>Simulation control</div>
           <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:9}}>{SPEEDS.map(s=><button key={s} style={{...css.button,padding:"7px 9px",color:room?.clock?.speed===s?colors.accent:colors.ink}} onClick={()=>command(s===0?"PAUSE":"SET_SPEED",{speed:s})} disabled={!isHost}>{s===0?"Ⅱ":"×"+s}</button>)}</div>
           {!isHost&&<div style={{fontSize:10,color:colors.muted,marginTop:8}}>Only the host controls world speed.</div>}
         </div>
         <div style={{...css.card,marginBottom:12}}>
           <div style={{fontSize:10,color:colors.muted,textTransform:"uppercase",letterSpacing:".1em"}}>National pulse</div>
           <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:9}}>
             <Metric label="Population" value={fmt(nation?.population)}/>
             <Metric label="Treasury" value={fmt(nation?.money)}/>
             <Metric label="Food" value={fmt(nation?.food)}/>
             <Metric label="Energy" value={fmt(nation?.energy)}/>
             <Metric label="Industry" value={fmt(nation?.industrialCapacity)}/>
             <Metric label="Materials" value={fmt(nation?.rawMaterials)}/>
           </div>
         </div>
         <div style={{...css.card,marginBottom:12}}>
           <div style={{fontSize:10,color:colors.muted,textTransform:"uppercase",letterSpacing:".1em"}}>People in room</div>
           <div style={{marginTop:7}}>{players.map(p=><div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",fontSize:12,borderBottom:"1px solid "+colors.line}}><span>{countryName(p.countryCode)}</span><span style={{color:p.connected?colors.green:colors.muted}}>{p.connected?"● online":"○ away"}</span></div>)}</div>
         </div>
         <div style={css.card}>
           <div style={{fontSize:10,color:colors.muted,textTransform:"uppercase",letterSpacing:".1em"}}>Situation feed</div>
           {notifications.length===0?<div style={{fontSize:12,color:colors.muted,marginTop:8}}>The world is quiet.</div>:notifications.map(n=><div key={n.id||Math.random()} style={{fontSize:11,padding:"8px 0",borderBottom:"1px solid "+colors.line}}>{n.message||n.kind}</div>)}
         </div>
         <div style={{...css.card,marginTop:12}}>
           <div style={{fontSize:10,color:colors.muted,textTransform:"uppercase",letterSpacing:".1em"}}>Secure channel</div>
           <div style={{display:"flex",gap:5,marginTop:8}}><input value={chatText} onChange={e=>setChatText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&chatText.trim()){send(socket,{type:"CHAT",text:chatText});setChatText("");}}} style={css.input} placeholder="Message the room"/></div>
           <button style={{...css.button,width:"100%",marginTop:6}} onClick={()=>{if(chatText.trim()){send(socket,{type:"CHAT",text:chatText});setChatText("");}}}>Transmit</button>
         </div>
       </aside>
     </div>
   </div>
 </div>;
}

function Overview({nation,events,units,activeTech,command,isHost,clock}){
 return <div style={{paddingTop:18}}>
   <SectionTitle eyebrow="National command" title="Your country at a glance"><span style={{fontSize:11,color:colors.muted}}>The map remains the battlefield. This room is your command layer.</span></SectionTitle>
   <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:9}}>
     <Metric label="Population" value={fmt(nation?.population)} sub="civilian base"/>
     <Metric label="Treasury" value={fmt(nation?.money)} sub="available capital" accent/>
     <Metric label="Industrial capacity" value={fmt(nation?.industrialCapacity)} sub="production potential"/>
     <Metric label="Food reserve" value={fmt(nation?.food)} sub="national supply"/>
     <Metric label="Energy reserve" value={fmt(nation?.energy)} sub="grid capacity"/>
     <Metric label="Army" value={fmt(units.reduce((a,u)=>a+Number(u?.strength||0),0))} sub={units.length+" formations"}/>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"1.25fr .75fr",gap:12,marginTop:12}}>
     <div style={css.card}><SectionTitle eyebrow="National agenda" title="What needs your attention?"/>
       {events.slice(0,4).map(e=><div key={e.id} style={{padding:"10px 0",borderBottom:"1px solid "+colors.line}}><b>{e.title}</b><div style={{fontSize:11,color:colors.muted,marginTop:3}}>{e.category} · expires {e.expiresAt}</div></div>)}
       {!events.length&&<div style={{color:colors.muted,fontSize:12}}>No urgent decisions. Use the quiet to build capacity.</div>}
     </div>
     <div style={css.card}><SectionTitle eyebrow="Research" title="Technology"/></div>
     <div style={{...css.card,gridColumn:"1 / -1"}}><SectionTitle eyebrow="Strategic posture" title="Simulation tempo"/>
       <div style={{fontSize:13,color:colors.muted}}>World date <b style={{color:colors.ink}}>{clock?.date}</b>. Time never pauses for decisions; unresolved events expire and auto-resolve.</div>
       {isHost&&<button style={{...css.button,marginTop:10}} onClick={()=>command("ACTION",{type:"food_crisis"})}>Test a domestic crisis</button>}
     </div>
   </div>
 </div>;
}

function Economy({nation,command}){
 return <div style={{paddingTop:18}}><SectionTitle eyebrow="Economy" title="Build the state"><span style={{fontSize:11,color:colors.muted}}>Queues progress with simulation time, including while disconnected.</span></SectionTitle>
   <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:9}}>{BUILDINGS.map(([id,branch,name,icon])=><div key={id} style={css.card}><div style={{fontSize:24}}>{icon}</div><div style={{fontWeight:650,marginTop:5}}>{name}</div><div style={{fontSize:11,color:colors.muted,margin:"4px 0 10px"}}>{branch}</div><button style={{...css.button,width:"100%"}} onClick={()=>command("BUILD",{type:id,level:1})}>Commission</button></div>)}</div>
   <div style={{...css.card,marginTop:12}}><b>Construction queue</b>{safeArray(nation?.constructionQueue).map(x=><div key={x.id} style={{fontSize:12,color:colors.muted,paddingTop:7}}>{x.type} · {Math.max(0,Math.round(x.remainingDays))} days remaining</div>)}{!nation?.constructionQueue?.length&&<div style={{fontSize:12,color:colors.muted,marginTop:7}}>No active projects.</div>}</div>
 </div>;
}

function Military({nation,units,command}){
 return <div style={{paddingTop:18}}><SectionTitle eyebrow="Military" title="Move forces with intent"><span style={{fontSize:11,color:colors.muted}}>Orders are server-authoritative and consume simulation time.</span></SectionTitle>
   <div style={{display:"grid",gap:9}}>{units.map(u=><div key={u.id} style={{...css.card,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}><div><b>{u.name}</b><div style={{fontSize:11,color:colors.muted}}>{u.type} · strength {fmt(u.strength)} · organization {fmt(u.organization)}</div></div><div style={{display:"flex",gap:5}}><button style={css.button} onClick={()=>command("MOVE_UNIT",{unitId:u.id,x:0,y:0})}>Front A</button><button style={css.button} onClick={()=>command("MOVE_UNIT",{unitId:u.id,x:20,y:30})}>Front B</button></div></div>)}</div>
 </div>;
}

function Diplomacy({myCode,players,target,setTarget,pending,socket}){
 const humans=players.filter(p=>p?.countryCode&&p.countryCode!==myCode);
 return <div style={{paddingTop:18}}><SectionTitle eyebrow="Diplomacy" title="Make the world react"><span style={{fontSize:11,color:colors.muted}}>Human proposals require acceptance. AI diplomacy remains simulated.</span></SectionTitle>
   <div style={{...css.card,display:"flex",gap:8,alignItems:"end"}}><div style={{flex:1}}><label style={css.label}>Recipient</label><select value={target} onChange={e=>setTarget(e.target.value)} style={css.input}>{COUNTRIES.filter(x=>x[0]!==myCode).map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></div><button style={css.button} onClick={()=>send(socket,{type:"DIPLOMACY_REQUEST",targetCountry:target,message:"Diplomatic proposal"})}>Propose</button></div>
   <div style={{...css.card,marginTop:12}}><b>Incoming proposals</b>{pending.length?pending.map(r=><div key={r.id} style={{padding:"10px 0",borderBottom:"1px solid "+colors.line}}><div>{countryName(r.fromCountry)} wants talks.</div><div style={{display:"flex",gap:6,marginTop:7}}><button style={css.button} onClick={()=>send(socket,{type:"DIPLOMACY_RESPONSE",requestId:r.id,accepted:true})}>Accept</button><button style={css.button} onClick={()=>send(socket,{type:"DIPLOMACY_RESPONSE",requestId:r.id,accepted:false})}>Decline</button></div></div>):<div style={{fontSize:12,color:colors.muted,marginTop:7}}>No pending proposals.</div>}</div>
 </div>;
}

function Events({events,command}){
 return <div style={{paddingTop:18}}><SectionTitle eyebrow="Decisions" title="The state never waits"><span style={{fontSize:11,color:colors.muted}}>Resolve crises while the simulation continues.</span></SectionTitle>
   {events.length?events.map(e=><div key={e.id} style={{...css.card,marginBottom:9}}><div style={{display:"flex",justifyContent:"space-between"}}><b>{e.title}</b><span style={{fontSize:11,color:e.priority>=4?colors.red:colors.accent}}>P{e.priority}</span></div><div style={{fontSize:11,color:colors.muted,margin:"5px 0 10px"}}>{e.category} · expires {e.expiresAt}</div><div style={{display:"flex",gap:7,flexWrap:"wrap"}}>{safeArray(e.choices).map(c=><button key={c.id} style={css.button} onClick={()=>command("EVENT_CHOICE",{eventId:e.id,choiceId:c.id})}>{c.label}</button>)}</div></div>):<div style={css.card}><div style={{fontSize:13}}>No decisions waiting.</div><div style={{fontSize:11,color:colors.muted,marginTop:4}}>That is not an empty game. It is a country in a breathing world.</div></div>}
 </div>;
}

function Lobby({connected,onCreate,onJoin,playerName,setPlayerName,country,setCountry,joinId,setJoinId,error}){
 return <div style={{...css.root,pointerEvents:"auto",display:"grid",placeItems:"center",background:"radial-gradient(circle at 50% 35%,rgba(214,179,106,.10),transparent 40%),rgba(4,7,11,.82)"}}>
   <div style={{width:"min(920px,calc(100vw - 32px))",maxHeight:"calc(100vh - 32px)",overflow:"auto",border:"1px solid "+colors.line,borderRadius:24,background:colors.panel,boxShadow:"0 30px 100px rgba(0,0,0,.65)",padding:26}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"start"}}><div><div style={{color:colors.accent,fontSize:11,letterSpacing:".18em",textTransform:"uppercase"}}>Open Historia · Grand Strategy</div><h1 style={{fontSize:34,lineHeight:1.05,margin:"8px 0"}}>Shape a nation.<br/>Watch history answer.</h1><p style={{color:colors.muted,maxWidth:620,lineHeight:1.55,margin:0}}>A persistent historical simulation beginning on 1 January 1920. You command policy, economy and forces; the server advances the world and the AI plays every unclaimed country.</p></div><div style={{fontSize:11,color:connected?colors.green:colors.red}}>{connected?"● SERVER ONLINE":"● CONNECTING"}</div></div>
     <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:24}}>
       <div style={css.card}><div style={{fontSize:11,color:colors.accent,textTransform:"uppercase",letterSpacing:".1em"}}>Create campaign</div><div style={{display:"grid",gap:10,marginTop:12}}><div><label style={css.label}>Commander</label><input style={css.input} value={playerName} onChange={e=>setPlayerName(e.target.value.slice(0,40))}/></div><div><label style={css.label}>Nation</label><select style={css.input} value={country} onChange={e=>setCountry(e.target.value)}>{COUNTRIES.map(x=><option key={x[0]} value={x[0]}>{x[1]} · {x[2]}</option>)}</select></div><button style={{...css.button,background:"rgba(214,179,106,.15)",borderColor:"rgba(214,179,106,.35)"}} disabled={!connected} onClick={onCreate}>Enter the world</button></div></div>
       <div style={css.card}><div style={{fontSize:11,color:colors.accent,textTransform:"uppercase",letterSpacing:".1em"}}>Join multiplayer</div><div style={{display:"grid",gap:10,marginTop:12}}><div><label style={css.label}>Room code</label><input style={css.input} value={joinId} onChange={e=>setJoinId(e.target.value.trim())} placeholder="rt-..."/></div><div><label style={css.label}>Nation</label><select style={css.input} value={country} onChange={e=>setCountry(e.target.value)}>{COUNTRIES.map(x=><option key={x[0]} value={x[0]}>{x[1]} · {x[2]}</option>)}</select></div><button style={css.button} disabled={!connected||!joinId} onClick={onJoin}>Join war room</button></div></div>
     </div>
     <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:12}}>{[["SERVER","Authoritative time & state"],["AI","Every unclaimed country acts"],["PERSISTENCE","Rejoin without losing progress"]].map(x=><div key={x[0]} style={{padding:12,borderRadius:12,background:"rgba(255,255,255,.025)",border:"1px solid "+colors.line}}><div style={{fontSize:10,color:colors.accent}}>{x[0]}</div><div style={{fontSize:11,color:colors.muted,marginTop:4}}>{x[1]}</div></div>)}</div>
     {error&&<div style={{marginTop:12,color:"#f0b0b0",fontSize:12}}>{error}</div>}
   </div>
 </div>;
}

export function RealtimeStrategy(){
 const [open,setOpen]=useState(false),[socket,setSocket]=useState(null),[connected,setConnected]=useState(false),[room,setRoom]=useState(null),[roomId,setRoomId]=useState(""),[playerId,setPlayerId]=useState(""),[playerName,setPlayerName]=useState("Commander"),[country,setCountry]=useState("GBR"),[joinId,setJoinId]=useState(""),[error,setError]=useState("");
 const socketRef=useRef(null);
 const connect=useCallback(()=>{if(socketRef.current)return;setError("");const s=new WebSocket(wsUrl());socketRef.current=s;s.onopen=()=>{setConnected(true);setSocket(s);};s.onclose=()=>{setConnected(false);setSocket(null);socketRef.current=null;};s.onerror=()=>setError("Realtime server unavailable. Start node server/server.js.");s.onmessage=e=>{try{const m=JSON.parse(e.data);switch(m.type){
   case"ROOM_CREATED":case"ROOM_JOINED":setRoomId(m.roomId||"");setPlayerId(m.playerId||"");setRoom(m.snapshot||null);if(m.playerId)localStorage.setItem("oh:rt:playerId",m.playerId);if(m.roomId)localStorage.setItem("oh:rt:roomId",m.roomId);break;
   case"SNAPSHOT":setRoom(m.snapshot||null);break;
   case"TIME_UPDATE":setRoom(r=>r?{...r,clock:m.clock||r.clock}:r);break;
   case"WORLD_UPDATE":setRoom(r=>r?{...r,events:Array.isArray(m.events)?m.events:r.events,notifications:Array.isArray(m.notifications)?m.notifications:r.notifications,countries:{...(r.countries||{}),...(m.countries||{})}}:r);break;
   case"BUILDING_UPDATE":case"RESEARCH_UPDATE":case"UNIT_UPDATE":case"EVENT_RESOLVED":setRoom(r=>r?{...r,...(m.snapshot||{}),countries:{...(r.countries||{}),...((m.snapshot||{}).countries||{})}}:r);break;
   case"DIPLOMACY_REQUEST":if(m.request)setRoom(r=>r?{...r,diplomacyRequests:[...(r.diplomacyRequests||[]),m.request]}:r);break;
   case"DIPLOMACY_RESPONSE":if(m.request)setRoom(r=>r?{...r,diplomacyRequests:(r.diplomacyRequests||[]).map(x=>x?.id===m.request.id?m.request:x)}:r);break;
   case"NOTIFICATION":if(m.notification)setRoom(r=>r?{...r,notifications:[m.notification,...(r.notifications||[])].slice(0,40),chat:m.notification.kind==="CHAT"?[...(r.chat||[]),m.notification].slice(-200):r.chat}:r);break;
   case"PLAYER_JOINED":if(m.player)setRoom(r=>r?{...r,players:{...(r.players||{}),[m.player.id]:m.player}}:r);break;
   case"PLAYER_LEFT":setRoom(r=>r?{...r,players:Object.fromEntries(Object.entries(r.players||{}).map(([id,p])=>[id,id===m.playerId?{...p,connected:false}:p]))}:r);break;
   case"ERROR":setError(m.error||"Server rejected the operation.");break;
   default:break;
 } }catch(err){console.error("Realtime message error",err);setError("Realtime message could not be read.");}};},[]);
 useEffect(()=>{if(open)connect();return()=>{};},[open,connect]);
 useEffect(()=>()=>socketRef.current?.close(),[]);
 const command=useCallback((action,payload)=>{setError("");send(socketRef.current,{type:"COMMAND",action,payload});},[]);
 const create=()=>send(socketRef.current,{type:"CREATE_ROOM",mode:"multi",name:"Open Historia · 1920",playerName,countryCode:country});
 const join=()=>send(socketRef.current,{type:"JOIN_ROOM",roomId:joinId,playerId:localStorage.getItem("oh:rt:playerId")||undefined,playerName,countryCode:country});
 if(!open)return <div style={css.root}><button type="button" style={css.launcher} onClick={()=>setOpen(true)}>◈ <b>WAR ROOM</b></button></div>;
 return <RealtimeBoundary>{room?<Hub room={room} setRoom={setRoom} playerId={playerId} socket={socket} roomId={roomId} playerName={playerName} country={country} command={command} error={error} setError={setError}/>:<Lobby connected={connected} onCreate={create} onJoin={join} playerName={playerName} setPlayerName={setPlayerName} country={country} setCountry={setCountry} joinId={joinId} setJoinId={setJoinId} error={error}/>}</RealtimeBoundary>;
}
