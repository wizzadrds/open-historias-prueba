import { useCallback, useEffect, useRef, useState } from "react";
import { activateGame, useLibraryState } from "../../runtime/library.js";

const wsUrl=()=>{
  const proto=location.protocol==="https:"?"wss":"ws";
  const host=location.hostname||"localhost";
  const port=import.meta.env.DEV?"3000":location.port;
  return proto+"://"+host+(port?":"+port:"")+"/ws/realtime";
};
const send=(socket,message)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
const getStored=(key)=>{try{return localStorage.getItem(key)||"";}catch{return "";}};
const setStored=(key,value)=>{try{localStorage.setItem(key,String(value||""));}catch{}};

export function useRealtimeSession(){
  const {activeGame}=useLibraryState();
  const [session,setSession]=useState({status:"idle",roomId:"",playerId:"",gameId:"",countryCode:"",clock:null,error:""});
  const socketRef=useRef(null);
  const pendingRef=useRef(null);

  const connect=useCallback((message)=>{
    pendingRef.current=message;
    if(socketRef.current?.readyState===WebSocket.OPEN){send(socketRef.current,message);return;}
    if(socketRef.current)return;
    setSession((s)=>({...s,status:"connecting",error:""}));
    const socket=new WebSocket(wsUrl());
    socketRef.current=socket;
    socket.onopen=()=>{
      if(socketRef.current!==socket)return;
      setSession((s)=>({...s,status:"connected",error:""}));
      if(pendingRef.current)send(socket,pendingRef.current);
    };
    socket.onclose=()=>{
      if(socketRef.current!==socket)return;
      socketRef.current=null;
      setSession((s)=>({...s,status:"disconnected"}));
    };
    socket.onerror=()=>setSession((s)=>({...s,status:"error",error:"No se pudo conectar al servidor multijugador."}));
    socket.onmessage=async(event)=>{
      let message;
      try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==="ROOM_CREATED"||message.type==="ROOM_JOINED"){
        const gameId=String(message.gameId||message.snapshot?.gameId||"");
        const player=message.snapshot?.players?.[message.playerId];
        const countryCode=String(message.countryCode||player?.countryCode||"");
        setSession((s)=>({...s,status:"in-game",roomId:message.roomId||"",playerId:message.playerId||"",gameId,countryCode,clock:message.snapshot?.clock||null,error:""}));
        setStored("oh:realtime:playerId",message.playerId);
        setStored("oh:realtime:roomId",message.roomId);
        if(gameId&&gameId!==activeGame?.id){
          try{await activateGame(gameId);}catch(error){setSession((s)=>({...s,status:"error",error:error.message||"No se pudo abrir la partida multijugador."}));}
        }
        window.dispatchEvent(new CustomEvent("oh:realtime-session-changed",{detail:{active:true,gameId,roomId:message.roomId,countryCode}}));
      }else if(message.type==="TIME_UPDATE"){
        setSession((s)=>({...s,clock:message.clock||s.clock}));
      }else if(message.type==="ERROR"){
        setSession((s)=>({...s,status:"error",error:message.error||"El servidor rechazó la operación."}));
      }
    };
  },[activeGame?.id]);

  const start=useCallback(()=>{
    if(!activeGame?.id){setSession((s)=>({...s,status:"error",error:"Primero abre una partida real de Open Historia."}));return;}
    connect({type:"CREATE_ROOM",gameId:activeGame.id,mode:"multi",name:activeGame.name,playerName:activeGame.country||"Player",countryCode:activeGame.country||""});
  },[activeGame,connect]);

  const join=useCallback((roomId)=>{
    const id=String(roomId||getStored("oh:realtime:roomId")).trim();
    if(!id){setSession((s)=>({...s,status:"error",error:"No hay una sala multijugador que reanudar."}));return;}
    connect({type:"JOIN_ROOM",roomId:id,playerId:getStored("oh:realtime:playerId")||undefined,playerName:activeGame?.country||"Player",countryCode:activeGame?.country||undefined});
  },[activeGame,connect]);

  const command=useCallback((action,payload={})=>send(socketRef.current,{type:"COMMAND",action,payload}),[]);
  const leave=useCallback(()=>{
    socketRef.current?.close();socketRef.current=null;pendingRef.current=null;
    setSession({status:"idle",roomId:"",playerId:"",gameId:"",countryCode:"",clock:null,error:""});
    window.dispatchEvent(new CustomEvent("oh:realtime-session-changed",{detail:{active:false}}));
  },[]);

  useEffect(()=>{
    const onStart=()=>start();
    const onJoin=(event)=>join(event.detail?.roomId);
    window.addEventListener("oh:start-realtime",onStart);
    window.addEventListener("oh:join-realtime",onJoin);
    return()=>{window.removeEventListener("oh:start-realtime",onStart);window.removeEventListener("oh:join-realtime",onJoin);socketRef.current?.close();};
  },[start,join]);

  return {...session,start,join,command,leave};
}
