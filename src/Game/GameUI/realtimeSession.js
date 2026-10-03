import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { activateGame, useLibraryState } from "../../runtime/library.js";
import { JSON_URLS, primeJson, readJson } from "../../runtime/assets.js";
import { setWorldStateOverride } from "../Map/useWorldState.js";

const wsUrl=()=>{
  const proto=location.protocol==="https:"?"wss":"ws";
  const host=location.hostname||"localhost";
  const port=import.meta.env.DEV?"3000":location.port;
  return proto+"://"+host+(port?":"+port:"")+"/ws/realtime";
};
const send=(socket,message)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
const getStored=(key)=>{try{return localStorage.getItem(key)||"";}catch{return "";}};
const setStored=(key,value)=>{try{localStorage.setItem(key,String(value||""));}catch{}};
const INITIAL_SESSION={status:"idle",roomId:"",playerId:"",gameId:"",countryCode:"",clock:null,rooms:[],error:""};
let realtimeSessionState=INITIAL_SESSION;
const realtimeListeners=new Set();
const publishRealtimeSession=(next)=>{realtimeSessionState=next;for(const listener of realtimeListeners)listener();};
export const getRealtimeSessionSnapshot=()=>realtimeSessionState;
export const subscribeRealtimeSession=(listener)=>{realtimeListeners.add(listener);return()=>realtimeListeners.delete(listener);};
export const useRealtimeSessionState=()=>useSyncExternalStore(subscribeRealtimeSession,getRealtimeSessionSnapshot,getRealtimeSessionSnapshot);
const mergeRealtimeSnapshot=(previous,next)=>({...previous,...next,clock:next?.clock??previous?.clock??null,game:next?.game??previous?.game??null,world:next?.world??previous?.world??null,countries:{...(previous?.countries||{}),...(next?.countries||{})},events:Array.isArray(next?.events)?next.events:(previous?.events||[]),notifications:Array.isArray(next?.notifications)?next.notifications:(previous?.notifications||[])});

export function useRealtimeSession(){
  const {activeGame}=useLibraryState();
  const [session,setSession]=useState(INITIAL_SESSION);
  const sessionRef=useRef(INITIAL_SESSION);
  const realtimeSnapshotRef=useRef(null);
  const applyServerWorld=useCallback(async(snapshot,gameId,roomId,playerId,countryCode)=>{realtimeSnapshotRef.current=mergeRealtimeSnapshot(realtimeSnapshotRef.current,snapshot);let baseWorld={};try{baseWorld=realtimeSnapshotRef.current?.world||await readJson(JSON_URLS.world,{defaultValue:{},force:false,clone:false})||{};}catch{}if(realtimeSnapshotRef.current?.game) primeJson(JSON_URLS.game,realtimeSnapshotRef.current.game,{clone:false});setWorldStateOverride({...baseWorld,realtime:realtimeSnapshotRef.current,multiplayer:{active:true,gameId,roomId,playerId,countryCode,clock:realtimeSnapshotRef.current?.clock||null}});},[]);
  useEffect(()=>{sessionRef.current=session;publishRealtimeSession(session);},[session]);
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
      if(message.type==="ROOM_LIST"){const next={...sessionRef.current,rooms:Array.isArray(message.rooms)?message.rooms:[]};sessionRef.current=next;setSession(next);publishRealtimeSession(next);
      }else if(message.type==="ROOM_CREATED"||message.type==="ROOM_JOINED"){
        const gameId=String(message.gameId||message.snapshot?.gameId||"");
        const player=message.snapshot?.players?.[message.playerId];
        const countryCode=String(message.countryCode||player?.countryCode||"");
        const nextSession={status:"in-game",roomId:message.roomId||"",playerId:message.playerId||"",gameId,countryCode,clock:message.snapshot?.clock||null,error:""};setSession(nextSession);sessionRef.current=nextSession;publishRealtimeSession(nextSession);
        setStored("oh:realtime:playerId",message.playerId);
        setStored("oh:realtime:roomId",message.roomId);
        if(gameId&&gameId!==activeGame?.id){
          try{await activateGame(gameId);}catch(error){setSession((s)=>({...s,status:"error",error:error.message||"No se pudo abrir la partida multijugador."}));}
        }
        await applyServerWorld(message.snapshot||{},gameId,message.roomId||"",message.playerId||"",countryCode);
        window.dispatchEvent(new CustomEvent("oh:realtime-session-changed",{detail:{active:true,gameId,roomId:message.roomId,countryCode}}));
      }else if(["TIME_UPDATE","BUILDING_UPDATE","RESEARCH_UPDATE","UNIT_UPDATE","EVENT_RESOLVED","WORLD_UPDATE"].includes(message.type)){
        realtimeSnapshotRef.current=mergeRealtimeSnapshot(realtimeSnapshotRef.current,message.snapshot||{});
        const next={...sessionRef.current,clock:realtimeSnapshotRef.current.clock||sessionRef.current.clock};sessionRef.current=next;setSession(next);publishRealtimeSession(next);
        await applyServerWorld(realtimeSnapshotRef.current,next.gameId,next.roomId,next.playerId,next.countryCode);
      }else if(message.type==="ERROR"){
        const next={...sessionRef.current,status:"error",error:message.error||"El servidor rechazó la operación."};sessionRef.current=next;setSession(next);publishRealtimeSession(next);
      }
    };
  },[activeGame?.id]);

  const listRooms=useCallback(()=>connect({type:"LIST_ROOMS"}),[connect]);

  const start=useCallback((options={})=>{
    if(!activeGame?.id){setSession((s)=>({...s,status:"error",error:"Primero abre una partida real de Open Historia."}));return;}
    connect({type:"CREATE_ROOM",gameId:activeGame.id,mode:"multi",visibility:options.visibility==="private"?"private":"public",name:activeGame.name,playerName:activeGame.country||"Player",countryCode:activeGame.country||""});
  },[activeGame,connect]);

  const join=useCallback((roomId)=>{
    const id=String(roomId||getStored("oh:realtime:roomId")).trim();
    if(!id){setSession((s)=>({...s,status:"error",error:"No hay una sala multijugador que reanudar."}));return;}
    connect({type:"JOIN_ROOM",roomId:id,playerId:getStored("oh:realtime:playerId")||undefined,playerName:activeGame?.country||"Player",countryCode:activeGame?.country||undefined});
  },[activeGame,connect]);

  const command=useCallback((action,payload={})=>send(socketRef.current,{type:"COMMAND",action,payload}),[]);
  const leave=useCallback(()=>{
    socketRef.current?.close();socketRef.current=null;pendingRef.current=null;
    realtimeSnapshotRef.current=null;setWorldStateOverride(null);
    sessionRef.current=INITIAL_SESSION;setSession(INITIAL_SESSION);publishRealtimeSession(INITIAL_SESSION);
    window.dispatchEvent(new CustomEvent("oh:realtime-session-changed",{detail:{active:false}}));
  },[]);

  useEffect(()=>{
    const onStart=()=>start();
    const onJoin=(event)=>join(event.detail?.roomId);
    window.addEventListener("oh:start-realtime",onStart);
    window.addEventListener("oh:join-realtime",onJoin);
    return()=>{window.removeEventListener("oh:start-realtime",onStart);window.removeEventListener("oh:join-realtime",onJoin);socketRef.current?.close();setWorldStateOverride(null);};
  },[start,join]);

  return {...session,start,join,listRooms,command,leave};
}
