export type BookSearchResult = {
  key:string;
  source:'openlibrary'|'google';
  title:string;
  author:string;
  cover:string;
  year?:number;
  isbn?:string;
  pages?:number;
  editionCount?:number;
  subjects?:string[];
};

export type BookDecisionDetails = BookSearchResult & {
  description?:string;
  subjects:string[];
};

const cleanSubjects=(subjects:any[]) => (subjects||[])
  .map(String)
  .map(s=>s.replace(/[_-]+/g,' ').trim())
  .filter(Boolean)
  .filter((s,i,a)=>a.findIndex(x=>x.toLowerCase()===s.toLowerCase())===i)
  .slice(0,18);

const normalize=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const workKey=(b:Pick<BookSearchResult,'title'|'author'>)=>`${normalize(b.title)}::${normalize(b.author)}`;
function rankBook(book:BookSearchResult,query:string){
  const q=normalize(query),title=normalize(book.title),author=normalize(book.author);
  let score=0;
  if(title===q)score+=120;
  else if(title.startsWith(q))score+=80;
  else if(title.includes(q))score+=55;
  if(author===q)score+=65;
  else if(author.includes(q))score+=30;
  if(book.cover)score+=14;
  if(book.isbn)score+=7;
  if(book.pages)score+=4;
  score+=Math.min(18,Math.log2(Math.max(1,book.editionCount||1))*3);
  return score;
}
function canonicalize(items:BookSearchResult[],query:string){
  const byWork=new Map<string,BookSearchResult>();
  for(const item of items){
    const key=workKey(item),existing=byWork.get(key);
    if(!existing||rankBook(item,query)>rankBook(existing,query))byWork.set(key,item);
  }
  return [...byWork.values()].sort((a,b)=>rankBook(b,query)-rankBook(a,query)).slice(0,18);
}

export async function searchBooks(query:string): Promise<BookSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const openUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=36&fields=key,title,author_name,cover_i,first_publish_year,isbn,number_of_pages_median,edition_count,subject,language`;
  try {
    const res = await fetch(openUrl);
    if (!res.ok) throw new Error('Open Library unavailable');
    const data = await res.json();
    const primary = (data.docs ?? []).map((d:any) => ({
      key:d.key,
      source:'openlibrary' as const,
      title:d.title,
      author:d.author_name?.[0] ?? 'Unknown author',
      cover:d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      year:d.first_publish_year,
      isbn:d.isbn?.find((x:string)=>String(x).length===13) || d.isbn?.[0],
      pages:d.number_of_pages_median,
      editionCount:d.edition_count,
      subjects:cleanSubjects(d.subject),
      _languages:d.language||[],
    })).filter((b:any)=>!b._languages?.length||b._languages.includes('eng'))
      .map(({_languages,...b}:any)=>b as BookSearchResult);
    if (primary.length) return canonicalize(primary,q);
  } catch {}

  const googleUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=30`;
  const res = await fetch(googleUrl);
  if (!res.ok) return [];
  const data = await res.json();
  const fallback=(data.items ?? []).map((item:any) => {
    const v = item.volumeInfo ?? {};
    return {
      key:item.id,
      source:'google' as const,
      title:v.title,
      author:v.authors?.[0] ?? 'Unknown author',
      cover:(v.imageLinks?.thumbnail ?? '').replace('http://','https://').replace('&zoom=1','&zoom=2'),
      year:Number((v.publishedDate ?? '').slice(0,4)) || undefined,
      isbn:v.industryIdentifiers?.find((x:any)=>x.type==='ISBN_13')?.identifier || v.industryIdentifiers?.[0]?.identifier,
      pages:v.pageCount,
      subjects:cleanSubjects(v.categories),
    } as BookSearchResult;
  });
  return canonicalize(fallback,q);
}

function descriptionText(v:any){
  if(!v) return undefined;
  if(typeof v==='string') return v;
  if(typeof v?.value==='string') return v.value;
  return undefined;
}

export async function getBookDecisionDetails(book:BookSearchResult):Promise<BookDecisionDetails>{
  if(book.source==='openlibrary' && book.key.startsWith('/works/')){
    try{
      const r=await fetch(`https://openlibrary.org${book.key}.json`);
      if(r.ok){
        const w=await r.json();
        return {...book,description:descriptionText(w.description),subjects:cleanSubjects([...(book.subjects||[]),...(w.subjects||[])])};
      }
    }catch{}
  }
  if(book.source==='google'){
    try{
      const r=await fetch(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(book.key)}`);
      if(r.ok){
        const x=await r.json(),v=x.volumeInfo||{};
        return {...book,description:v.description||undefined,pages:book.pages||v.pageCount,subjects:cleanSubjects([...(book.subjects||[]),...(v.categories||[])])};
      }
    }catch{}
  }
  return {...book,subjects:book.subjects||[]};
}

export async function getKnownChapterCount(book:{title:string;author:string;isbn?:string}):Promise<number|undefined>{
  try{
    const q=book.isbn?`isbn:${book.isbn}`:`title:${book.title} author:${book.author}`;
    const search=await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=3&fields=key`);
    if(!search.ok)return undefined;
    const data=await search.json();
    const key=data.docs?.find((d:any)=>String(d.key||'').startsWith('/works/'))?.key;
    if(!key)return undefined;
    const work=await fetch(`https://openlibrary.org${key}.json`);
    if(!work.ok)return undefined;
    const json=await work.json();
    const toc=Array.isArray(json.table_of_contents)?json.table_of_contents:[];
    if(toc.length<2)return undefined;
    const chapterish=toc.filter((entry:any)=>{
      const label=String(entry?.title||entry?.label||'').trim();
      if(!label)return false;
      return !/^(contents|acknowledg|copyright|bibliograph|index|notes|about the author)$/i.test(label);
    });
    const count=chapterish.length||toc.length;
    return count>=2&&count<=180?count:undefined;
  }catch{return undefined}
}

const topicRules:[RegExp,string][]=[
  [/mystery|thriller|crime|murder|detective/i,'mystery & motive'],
  [/family|marriage|relationship|friendship|love/i,'relationships'],
  [/women|gender|femin|identity/i,'identity & gender'],
  [/politic|power|class|wealth|society/i,'power & society'],
  [/war|history|historical/i,'history & memory'],
  [/grief|death|loss|mourning/i,'grief & mortality'],
  [/psycholog|mental|memory/i,'psychology & memory'],
  [/race|racism|immigration|diaspora/i,'race & belonging'],
  [/religion|faith/i,'faith & belief'],
  [/coming of age|young adult|youth/i,'growing up'],
  [/essay|essays/i,'ideas & observation'],
  [/memoir|biograph/i,'life & memory'],
];

export function buildLocalDecisionGuide(book:BookDecisionDetails){
  const text=book.subjects.join(' · ');
  const topics=topicRules.filter(([r])=>r.test(text)).map(([,label])=>label).slice(0,4);
  const pages=book.pages;
  const hours=pages?Math.max(2,Math.round(pages/32)):undefined;
  const weekly=pages?Math.ceil(pages/4):undefined;
  const commitment=pages
    ? pages<240?`Pretty manageable for a month: about ${hours} hours total, or roughly ${weekly} pages a week.`
      : pages<420?`A medium commitment: about ${hours} hours total, or roughly ${weekly} pages a week over a month.`
      : `A bigger month: around ${hours} hours total. Better if everyone is up for roughly ${weekly} pages a week.`
    : 'Page count varies by edition, so check the copy everyone is likely to use before setting the month.';
  const shape=/essay/i.test(text)?'essay collection':/memoir|biograph/i.test(text)?'memoir / nonfiction':/short stories/i.test(text)?'short-story collection':/poetry/i.test(text)?'poetry':/fiction|novel/i.test(text)?'novel':'book';
  const discussion=topics.length?`Likely discussion topics: ${topics.join(', ')}.`:'The catalog does not expose enough subject data to predict discussion themes reliably.';
  const fit=/mystery|thriller|crime/i.test(text)?'Good if your group likes theories, motives, and comparing what everyone noticed.'
    :/essay/i.test(text)?'Good if your group wants a flexible month: people can discuss individual pieces even if they read at slightly different speeds.'
    :/memoir|biograph/i.test(text)?'Good if your group likes talking about choices, perspective, memory, and how a life gets narrated.'
    :'Good if your group wants a book where interpretation and reactions can carry the conversation, not just plot recap.';
  return {shape,commitment,discussion,fit,topics:topics.length?topics:book.subjects.slice(0,4).map(s=>s.toLowerCase())};
}
