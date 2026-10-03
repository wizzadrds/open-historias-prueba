import React,{Component,useCallback,useEffect,useRef,useState} from "react";

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
const wsUrl=()=>{const proto=location.protocol==="https:"?"wss":"ws";const host=location.hostname||"localhost";const port=import.meta.env.DEV?"3000":location.port;return proto+"://"+host+(port?":"+port:"")+"/ws/realtime";};
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

function Hub({room,setRoom,playerId,socket,country,command,error}){
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
         {tab==="overview"&&<Overview nation={nation} events={events} units={units} command={command} isHost={isHost} clock={room?.clock}/>}
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

function Overview({nation,events,units,command,isHost,clock}){
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

function MainMenu({connected,onCreate,onJoin,playerName,setPlayerName,country,setCountry,joinId,setJoinId,error,mode,setMode,rooms,setRooms,t,language,setLanguage}){
 const [screen,setScreen]=useState("home");
 const [selectedMode,setSelectedMode]=useState("classic");
 const [refreshing,setRefreshing]=useState(false);
 const refresh=()=>{setRefreshing(true);send(window.__ohRealtimeSocket,{type:"LIST_ROOMS"});setTimeout(()=>setRefreshing(false),500);};
 const community=[
  {id:"classic",title:t("Grand Campaign","Gran campaña"),desc:t("Start in 1920. Build a nation and let history unfold.","Comienza en 1920. Construye tu nación y deja que la historia evolucione."),meta:t("1920 · Full simulation","1920 · Simulación completa")},
  {id:"europe",title:t("Europe at the Crossroads","Europa en la encrucijada"),desc:t("A focused European campaign built for diplomacy and industrial competition.","Una campaña europea centrada en diplomacia y competencia industrial."),meta:t("Community scenario","Escenario de la comunidad")},
  {id:"crisis",title:t("Age of Crisis","Era de crisis"),desc:t("Faster pressure: events, shortages and political decisions arrive earlier.","Más presión: eventos, escasez y decisiones políticas llegan antes."),meta:t("Community scenario","Escenario de la comunidad")}
 ];
 const create=()=>onCreate(selectedMode);
 return <div style={{...css.root,pointerEvents:"auto",background:"radial-gradient(circle at 50% 20%,rgba(214,179,106,.13),transparent 42%),linear-gradient(180deg,#080b10,#05070a)"}}>
   <div style={{position:"absolute",inset:0,background:"linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px)",backgroundSize:"48px 48px",pointerEvents:"none"}}/>
   <div style={{position:"relative",width:"min(1180px,calc(100vw - 48px))",height:"min(820px,calc(100vh - 48px))",margin:"24px auto",display:"grid",gridTemplateRows:"auto 1fr auto",overflow:"hidden",border:"1px solid "+colors.line,borderRadius:24,background:"rgba(8,11,16,.93)",boxShadow:"0 35px 120px rgba(0,0,0,.65)"}}>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 26px",borderBottom:"1px solid "+colors.line}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}><div style={{width:42,height:42,borderRadius:12,display:"grid",placeItems:"center",background:"linear-gradient(135deg,#d6b36a,#6c5630)",color:"#17120a",fontWeight:900}}>OH</div><div><div style={{fontSize:10,color:colors.accent,letterSpacing:".2em",textTransform:"uppercase"}}>Open Historia</div><div style={{fontSize:13,color:colors.muted}}>{t("Grand strategy · 1920","Gran estrategia · 1920")}</div></div></div>
      <div style={{display:"flex",gap:7,alignItems:"center"}}><button style={css.button} onClick={()=>setLanguage(language==="es"?"en":"es")}>{language==="es"?"EN":"ES"}</button><button style={css.button} onClick={()=>setScreen("home")}>{t("Main menu","Menú principal")}</button></div>
    </header>
    <main style={{overflow:"auto",padding:"34px 34px 28px"}}>
      {screen==="home"&&<div>
        <div style={{maxWidth:760,marginBottom:28}}><div style={{fontSize:11,color:colors.accent,letterSpacing:".18em",textTransform:"uppercase"}}>{t("A living history","Una historia viva")}</div><h1 style={{fontSize:"clamp(36px,5vw,64px)",lineHeight:.98,letterSpacing:"-.04em",margin:"8px 0 14px"}}>{t("Your nation. Your decisions. A world that never stops.","Tu nación. Tus decisiones. Un mundo que nunca se detiene.")}</h1><p style={{fontSize:15,lineHeight:1.6,color:colors.muted,maxWidth:680,margin:0}}>{t("Choose how you want to play. Single-player campaigns are populated by AI nations; multiplayer campaigns persist on the server so you can return later.","Elige cómo quieres jugar. En las campañas individuales las demás naciones las dirige la IA; las campañas multijugador quedan guardadas en el servidor para volver más tarde.")}</p></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:14}}>
          <button onClick={()=>setScreen("single")} style={{...css.card,textAlign:"left",cursor:"pointer",minHeight:170}}><div style={{fontSize:28}}>◉</div><div style={{fontSize:23,fontWeight:700,marginTop:12}}>{t("Single player","Un jugador")}</div><div style={{fontSize:13,color:colors.muted,marginTop:7,lineHeight:1.5}}>{t("Build your country against an active AI world. Pause, accelerate and shape your own history.","Construye tu país frente a un mundo controlado por una IA activa. Acelera el tiempo y crea tu propia historia.")}</div></button>
          <button onClick={()=>{setScreen("multi");refresh();}} style={{...css.card,textAlign:"left",cursor:"pointer",minHeight:170}}><div style={{fontSize:28}}>◎</div><div style={{fontSize:23,fontWeight:700,marginTop:12}}>{t("Multiplayer","Multijugador")}</div><div style={{fontSize:13,color:colors.muted,marginTop:7,lineHeight:1.5}}>{t("Persistent shared worlds. Invite friends, return later and let the same history continue.","Mundos compartidos persistentes. Invita a tus amigos, vuelve después y continúa la misma historia.")}</div></button>
        </div>
        <SectionTitle eyebrow={t("Community","Comunidad")} title={t("Scenarios & game modes","Escenarios y modos de juego")}><span style={{fontSize:11,color:colors.muted}}>{t("Curated foundations for the community","Bases seleccionadas para la comunidad")}</span></SectionTitle>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>{community.map(m=><button key={m.id} onClick={()=>{setSelectedMode(m.id);setScreen("single");}} style={{...css.card,textAlign:"left",cursor:"pointer"}}><div style={{fontSize:10,color:colors.accent,textTransform:"uppercase"}}>{m.meta}</div><div style={{fontSize:16,fontWeight:650,marginTop:6}}>{m.title}</div><div style={{fontSize:12,color:colors.muted,lineHeight:1.45,marginTop:6}}>{m.desc}</div></button>)}</div>
      </div>}
      {screen==="single"&&<Setup title={t("New single-player campaign","Nueva campaña individual")} subtitle={t("Choose a scenario and your nation. The rest of the world is AI.","Elige un escenario y tu nación. El resto del mundo lo controla la IA.")} onBack={()=>setScreen("home")} playerName={playerName} setPlayerName={setPlayerName} country={country} setCountry={setCountry} selectedMode={selectedMode} setSelectedMode={setSelectedMode} community={community} onCreate={create} connected={connected} t={t}/>}
      {screen==="multi"&&<div><div style={{display:"flex",justifyContent:"space-between",alignItems:"end",marginBottom:18}}><div><div style={{fontSize:11,color:colors.accent,textTransform:"uppercase"}}>{t("Persistent worlds","Mundos persistentes")}</div><h2 style={{fontSize:30,margin:"5px 0"}}>{t("Multiplayer","Multijugador")}</h2><div style={{color:colors.muted,fontSize:13}}>{t("Create a new world or continue one that already exists.","Crea un mundo nuevo o continúa uno que ya existe.")}</div></div><button style={css.button} onClick={()=>setScreen("home")}>← {t("Back","Volver")}</button></div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 330px",gap:14}}>
          <div><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><b>{t("Your campaigns","Tus campañas")}</b><button style={css.button} onClick={refresh}>{refreshing?"…":t("Refresh","Actualizar")}</button></div>
            {rooms.length===0?<div style={{...css.card,padding:28,textAlign:"center",color:colors.muted}}>{t("No saved multiplayer worlds yet.","Todavía no hay mundos multijugador guardados.")}</div>:rooms.map(r=><div key={r.id} style={{...css.card,marginBottom:8,display:"flex",justifyContent:"space-between",gap:14,alignItems:"center"}}><div><div style={{fontSize:16,fontWeight:650}}>{r.name||"Open Historia"}</div><div style={{fontSize:11,color:colors.muted,marginTop:4}}>{r.date} · {r.playerCount} {t("players","jugadores")} · {r.id}</div></div><button style={css.button} onClick={()=>{setJoinId(r.id);onJoin(r.id);}} disabled={!connected}>{t("Continue","Continuar")}</button></div>)}</div>
          <div style={css.card}><div style={{fontSize:11,color:colors.accent,textTransform:"uppercase"}}>{t("Host a world","Crear mundo")}</div><h3 style={{fontSize:22,margin:"7px 0"}}>{t("New multiplayer campaign","Nueva campaña multijugador")}</h3><div style={{display:"grid",gap:10}}><div><label style={css.label}>{t("Commander","Comandante")}</label><input style={css.input} value={playerName} onChange={e=>setPlayerName(e.target.value.slice(0,40))}/></div><div><label style={css.label}>{t("Nation","Nación")}</label><select style={css.input} value={country} onChange={e=>setCountry(e.target.value)}>{COUNTRIES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></div><button style={{...css.button,background:"rgba(214,179,106,.15)"}} onClick={()=>{setMode("multi");onCreate("classic");}} disabled={!connected}>{t("Create world","Crear mundo")}</button></div></div>
        </div>
      </div>}
    </main>
    <footer style={{padding:"12px 26px",borderTop:"1px solid "+colors.line,fontSize:11,color:colors.muted,display:"flex",justifyContent:"space-between"}}><span>{connected?"● "+t("Online","Conectado"):"○ "+t("Connecting to server","Conectando al servidor")}</span><span>Open Historia · 1920</span></footer>
   </div>
 </div>;
}
function Setup({title,subtitle,onBack,playerName,setPlayerName,country,setCountry,selectedMode,setSelectedMode,community,onCreate,connected,t}){
 return <div style={{maxWidth:900,margin:"0 auto"}}><button style={css.button} onClick={onBack}>← {t("Back","Volver")}</button><div style={{margin:"24px 0"}}><div style={{fontSize:11,color:colors.accent,textTransform:"uppercase"}}>{t("Campaign setup","Configuración")}</div><h2 style={{fontSize:32,margin:"5px 0"}}>{title}</h2><p style={{color:colors.muted}}>{subtitle}</p></div><div style={{display:"grid",gridTemplateColumns:"1.2fr .8fr",gap:14}}><div><b>{t("Scenarios","Escenarios")}</b><div style={{display:"grid",gap:8,marginTop:9}}>{community.map(m=><button key={m.id} onClick={()=>setSelectedMode(m.id)} style={{...css.card,textAlign:"left",cursor:"pointer",borderColor:selectedMode===m.id?colors.accent:colors.line}}><div style={{fontWeight:650}}>{m.title}</div><div style={{fontSize:11,color:colors.muted,marginTop:4}}>{m.desc}</div></button>)}</div></div><div style={css.card}><div><label style={css.label}>{t("Commander","Comandante")}</label><input style={css.input} value={playerName} onChange={e=>setPlayerName(e.target.value.slice(0,40))}/></div><div style={{marginTop:10}}><label style={css.label}>{t("Nation","Nación")}</label><select style={css.input} value={country} onChange={e=>setCountry(e.target.value)}>{COUNTRIES.map(x=><option key={x[0]} value={x[0]}>{x[1]}</option>)}</select></div><button style={{...css.button,width:"100%",marginTop:14,background:"rgba(214,179,106,.15)"}} onClick={()=>onCreate(selectedMode)} disabled={!connected}>{t("Start campaign","Comenzar campaña")}</button></div></div></div>;
}

export function RealtimeStrategy(){
 const [open,setOpen]=useState(false),[socket,setSocket]=useState(null),[connected,setConnected]=useState(false),[room,setRoom]=useState(null),[roomId,setRoomId]=useState(""),[playerId,setPlayerId]=useState(""),[playerName,setPlayerName]=useState("Commander"),[country,setCountry]=useState("GBR"),[joinId,setJoinId]=useState(""),[error,setError]=useState(""),[mode,setMode]=useState("single"),[rooms,setRooms]=useState([]),[language,setLanguage]=useState((localStorage.getItem("language")||document.documentElement.lang||navigator.language||"en").toLowerCase().startsWith("es")?"es":"en");
 const socketRef=useRef(null);
 const connect=useCallback(()=>{if(socketRef.current)return;setError("");const s=new WebSocket(wsUrl());socketRef.current=s;s.onopen=()=>{setConnected(true);setSocket(s);};s.onclose=()=>{setConnected(false);setSocket(null);socketRef.current=null;};s.onerror=()=>setError("Realtime server unavailable. Start node server/server.js.");s.onmessage=e=>{try{const m=JSON.parse(e.data);switch(m.type){
   case"ROOM_LIST":setRooms(Array.isArray(m.rooms)?m.rooms:[]);break;
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
 useEffect(()=>{if(open){connect();setTimeout(()=>send(socketRef.current,{type:"LIST_ROOMS"}),300);}return()=>{};},[open,connect]);
 useEffect(()=>()=>socketRef.current?.close(),[]);
 const command=useCallback((action,payload)=>{setError("");send(socketRef.current,{type:"COMMAND",action,payload});},[]);
 const t=(en,es)=>language==="es"?es:en;
 const create=(scenario="classic")=>send(socketRef.current,{type:"CREATE_ROOM",mode,name:mode==="multi"?"Open Historia · Multiplayer 1920":"Open Historia · 1920 Campaign",scenario,playerName,countryCode:country});
 const join=(id=joinId)=>send(socketRef.current,{type:"JOIN_ROOM",roomId:id,playerId:localStorage.getItem("oh:rt:playerId")||undefined,playerName,countryCode:country});
 if(!open)return <div style={css.root}><button type="button" style={css.launcher} onClick={()=>setOpen(true)}>◈ <b>OPEN HISTORIA</b></button></div>;
 return <RealtimeBoundary>{room?<Hub room={room} setRoom={setRoom} playerId={playerId} socket={socket} country={country} command={command} error={error}/>:<MainMenu connected={connected} onCreate={create} onJoin={join} playerName={playerName} setPlayerName={setPlayerName} country={country} setCountry={setCountry} joinId={joinId} setJoinId={setJoinId} error={error} mode={mode} setMode={setMode} rooms={rooms} setRooms={setRooms} t={t} language={language} setLanguage={setLanguage}/>}</RealtimeBoundary>;
}
