import type { BookDecisionDetails } from './books';
import { supabase } from './supabase';
const DEV_API = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/,'');
const API = import.meta.env.DEV ? DEV_API : ''; // Production uses the same-origin Pages Function service binding.

async function authHeaders(extra:Record<string,string>={}){
  const token=(await supabase?.auth.getSession())?.data.session?.access_token;
  return {...extra,...(token?{authorization:`Bearer ${token}`}:{})};
}
async function apiJson(path:string,init:RequestInit={}){
  const r=await fetch(`${API}${path}`,{...init,headers:await authHeaders(init.headers as Record<string,string>||{})});
  const contentType=r.headers.get('content-type')||'';
  const body=contentType.includes('application/json')?await r.json().catch(()=>({})):{};
  if(!r.ok)throw new Error(body?.error||`Request failed (${r.status})`);
  if(!contentType.includes('application/json'))throw new Error('Book Club API route returned a non-JSON response.');
  return body;
}

export async function enrichBook(title:string, author:string) {
  try{return await apiJson(`/api/enrich?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`)}catch{return null}
}

export async function resolveBookCover(input:{title:string;author:string;isbn?:string;currentCover?:string}){
  try{
    const j=await apiJson('/api/book-cover/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    return typeof j?.url==='string'&&j.url?{url:j.url,source:String(j?.source||'')} : null;
  }catch{return null}
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

export async function getReaderContext(input:{bookId?:string;title:string;author:string;year?:number;chapter?:number}):Promise<ReaderContextItem[]>{
  const j=await apiJson('/api/reader-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  return Array.isArray(j?.items)?j.items:[];
}

export type MeetingGuide={
  themes:string[];
  characters:string[];
  plotQuestions:string[];
  openingQuestion?:string;
  sourceBacked:boolean;
  ai:boolean;
};
export async function getMeetingGuide(input:{
  title:string;
  author:string;
  year?:number;
  checkpoint?:{label?:string;targetChapter?:number;targetPage?:number;previousTargetChapter?:number;previousTargetPage?:number;isFinal?:boolean};
  clubQuestions?:Array<{body:string;author?:string}>;
  sharedPosts?:Array<{type:string;body:string;chapter?:number;author?:string;reactions?:number}>;
}):Promise<MeetingGuide|null>{
  try{
    const j=await apiJson('/api/meeting-guide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    return{
      themes:Array.isArray(j?.themes)?j.themes.map(String).filter(Boolean).slice(0,4):[],
      characters:Array.isArray(j?.characters)?j.characters.map(String).filter(Boolean).slice(0,4):[],
      plotQuestions:Array.isArray(j?.plotQuestions)?j.plotQuestions.map(String).filter(Boolean).slice(0,4):[],
      openingQuestion:typeof j?.openingQuestion==='string'?j.openingQuestion:undefined,
      sourceBacked:Boolean(j?.sourceBacked),
      ai:Boolean(j?.ai),
    };
  }catch{return null}
}

export type ClubRecommendation={title:string;author:string;reason:string;cover?:string;year?:number;pages?:number;isbn?:string;description?:string;confidence?:string};
export async function getClubRecommendations(clubId:string):Promise<ClubRecommendation[]>{
  try{
    const j=await apiJson('/api/recommendations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clubId})});
    return Array.isArray(j?.suggestions)?j.suggestions:[];
  }catch{return[]}
}

export type CalendarStatus={configured:boolean;connected:boolean;email?:string;lastSyncedAt?:string;planSynced?:boolean};
export async function getCalendarStatus(clubBookId?:string):Promise<CalendarStatus>{
  try{return await apiJson(`/api/calendar/status${clubBookId?`?clubBookId=${encodeURIComponent(clubBookId)}`:''}`)}catch{return{configured:true,connected:false}}
}
export async function beginCalendarConnect(){
  const j=await apiJson('/api/calendar/start',{method:'POST'});if(!j?.url)throw new Error('Could not start Google Calendar connection.');window.location.assign(j.url);
}
export async function disconnectCalendar(){return apiJson('/api/calendar/disconnect',{method:'POST'})}
export async function syncMeetingToCalendar(meetingId:string){return apiJson('/api/calendar/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({meetingId})})}
export async function removeMeetingFromCalendar(meetingId:string){return apiJson('/api/calendar/remove-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({meetingId})})}
export async function syncReadingPlanToCalendar(clubBookId:string){return apiJson('/api/calendar/sync-reading-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clubBookId})})}
export async function removeReadingPlanFromCalendar(clubBookId:string){return apiJson('/api/calendar/remove-reading-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clubBookId})})}
export async function getApiHealth(){try{return{...(await apiJson('/api/health')),configured:true}}catch{return{ok:false,configured:Boolean(API||!import.meta.env.DEV)}}}

export type DiscoveryBook={key:string;source:'nyt';title:string;author:string;cover:string;year?:number;isbn?:string;subjects?:string[];rank?:number;weeksOnList?:number;listName?:string;storeUrl?:string};
export type BookDiscoveryResponse={
  nyt:DiscoveryBook[];
  nytConfigured:boolean;
  nytStatus:'ok'|'error'|'not_configured';
  nytError?:string;
  apiReachable:boolean;
};
export async function getBookDiscovery():Promise<BookDiscoveryResponse>{
  try{
    const j=await apiJson('/api/book-discovery');
    return{
      nyt:Array.isArray(j?.nyt)?j.nyt:[],
      nytConfigured:Boolean(j?.nytConfigured),
      nytStatus:j?.nytStatus==='ok'||j?.nytStatus==='error'||j?.nytStatus==='not_configured'?j.nytStatus:(j?.nytConfigured?'ok':'not_configured'),
      nytError:typeof j?.nytError==='string'?j.nytError:undefined,
      apiReachable:true,
    };
  }catch(err:any){
    return{nyt:[],nytConfigured:false,nytStatus:'error',nytError:err?.message||'Book Club API could not be reached.',apiReachable:false};
  }
}


export type PassageTranscription={
  text:string;
  confidence:number;
  needsReview:boolean;
  pageNumber?:number;
  chapterNumber?:number;
};
export async function transcribePassage(input:{imageDataUrl:string;title:string;author:string;currentChapter?:number}):Promise<PassageTranscription>{
  const j=await apiJson('/api/transcribe-passage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  return {text:String(j?.text||''),confidence:Number(j?.confidence||0),needsReview:Boolean(j?.needsReview),pageNumber:Number(j?.pageNumber)||undefined,chapterNumber:Number(j?.chapterNumber)||undefined};
}
