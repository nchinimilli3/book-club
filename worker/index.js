const json = (data, status=200, extra={}) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json','access-control-allow-origin':'*',...extra}});
async function fetchJson(url, init){ const r=await fetch(url,init); if(!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(request.method==='OPTIONS') return new Response(null,{headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}});
    if(url.pathname==='/api/health') return json({ok:true,services:{openLibrary:true,wikidata:true,tmdb:Boolean(env.TMDB_BEARER_TOKEN),youtube:Boolean(env.YOUTUBE_API_KEY)}});
    if(url.pathname==='/api/enrich'){
      const title=url.searchParams.get('title')||''; const author=url.searchParams.get('author')||'';
      if(!title) return json({error:'title required'},400);
      const out={title,author,openLibrary:null,wikipedia:null,adaptations:[],videos:[],sources:[]};
      try{out.openLibrary=await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=3`);out.sources.push({name:'Open Library',url:'https://openlibrary.org/'});}catch(e){}
      try{const s=await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title+' '+author)}&utf8=1&format=json&origin=*`); const hit=s?.query?.search?.[0]; if(hit){const p=await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);out.wikipedia={title:p.title,extract:p.extract,url:p.content_urls?.desktop?.page};out.sources.push({name:'Wikipedia',url:p.content_urls?.desktop?.page});}}catch(e){}
      if(env.TMDB_BEARER_TOKEN){try{const t=await fetchJson(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(title)}&include_adult=false`,{headers:{Authorization:`Bearer ${env.TMDB_BEARER_TOKEN}`}});out.adaptations=(t.results||[]).slice(0,5).map(x=>({id:x.id,type:x.media_type,title:x.title||x.name,year:(x.release_date||x.first_air_date||'').slice(0,4),poster:x.poster_path?`https://image.tmdb.org/t/p/w500${x.poster_path}`:null}));}catch(e){}}
      if(env.YOUTUBE_API_KEY){try{const y=await fetchJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(title+' '+author+' interview')}&key=${env.YOUTUBE_API_KEY}`);out.videos=(y.items||[]).map(v=>({id:v.id.videoId,title:v.snippet.title,channel:v.snippet.channelTitle}));}catch(e){}}
      return json(out);
    }
    return json({error:'not found'},404);
  }
};
