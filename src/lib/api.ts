import type { BookDecisionDetails } from './books';
import { supabase } from './supabase';
const API = import.meta.env.VITE_API_BASE_URL || '';

async function authHeaders(extra:Record<string,string>={}){
  const token=(await supabase?.auth.getSession())?.data.session?.access_token;
  return {...extra,...(token?{authorization:`Bearer ${token}`}:{})};
}
async function apiJson(path:string,init:RequestInit={}){
  if(!API)throw new Error('BOOK CLUB API is not configured.');
  const r=await fetch(`${API}${path}`,{...init,headers:await authHeaders(init.headers as Record<string,string>||{})});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(body?.error||`Request failed (${r.status})`);
  return body;
}

export async function enrichBook(title:string, author:string) {
  if (!API) return null;
  try{return await apiJson(`/api/enrich?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`)}catch{return null}
}

export type DecisionGuide = {
  whatItsAbout:string;
  whyItWorks:string;
  conversation:string[];
  vibe:string[];
  headsUp?:string;
  sourceBacked:boolean;
};

export async function getDecisionGuide(book:BookDecisionDetails):Promise<DecisionGuide|null>{
  if(!API)return null;
  try{return await apiJson('/api/book-decision',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({title:book.title,author:book.author,year:book.year,pages:book.pages,description:book.description?.slice(0,5000),subjects:book.subjects.slice(0,20)})
    })}catch{return null}
}

export type ReaderContextItem = {
  id?:string;
  kind:string;
  title:string;
  summary_short?:string;
  summary_medium?:string;
  summary_deep?:string;
  spoiler_chapter?:number|null;
  context_sources?:Array<{source_url?:string;source_name?:string;source_type?:string}>;
};

export async function getReaderContext(input:{title:string;author:string;year?:number;chapter?:number}):Promise<ReaderContextItem[]>{
  if(!API)return[];
  try{const j=await apiJson('/api/reader-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});return Array.isArray(j?.items)?j.items:[]}catch{return[]}
}

export type ClubRecommendation={title:string;author:string;reason:string;cover?:string;year?:number;pages?:number;isbn?:string;description?:string;confidence?:string};
export async function getClubRecommendations(clubId:string):Promise<ClubRecommendation[]>{
  const j=await apiJson('/api/recommendations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clubId})});
  return Array.isArray(j?.suggestions)?j.suggestions:[];
}

export type CalendarStatus={configured:boolean;connected:boolean;email?:string;lastSyncedAt?:string};
export async function getCalendarStatus():Promise<CalendarStatus>{
  if(!API)return{configured:false,connected:false};
  try{return await apiJson('/api/calendar/status')}catch{return{configured:true,connected:false}}
}
export async function beginCalendarConnect(){
  const j=await apiJson('/api/calendar/start',{method:'POST'});if(!j?.url)throw new Error('Could not start Google Calendar connection.');window.location.assign(j.url);
}
export async function disconnectCalendar(){return apiJson('/api/calendar/disconnect',{method:'POST'})}
export async function syncMeetingToCalendar(meetingId:string){return apiJson('/api/calendar/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({meetingId})})}
export async function removeMeetingFromCalendar(meetingId:string){return apiJson('/api/calendar/remove-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({meetingId})})}
export async function getApiHealth(){if(!API)return{ok:false,configured:false};try{return{...(await apiJson('/api/health')),configured:true}}catch{return{ok:false,configured:true}}}
