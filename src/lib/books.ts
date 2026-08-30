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

export function displayBookGenres(subjects:string[]=[]){
  const text=subjects.join(' · ');
  const candidates:[RegExp,string][]=[
    [/fantasy|magic|wizard|witch|supernatural|ghost|monster|vampire/i,'Fantasy'],
    [/mystery|detective|crime/i,'Mystery'],[/thriller|suspense/i,'Thriller'],
    [/romance|love stor/i,'Romance'],[/science fiction|sci fi|dystop/i,'Science fiction'],
    [/historical/i,'Historical fiction'],[/memoir|autobiograph/i,'Memoir'],
    [/biograph/i,'Biography'],[/young adult|juvenile|children|childrens/i,"Children's / YA"],
    [/poetry|poems/i,'Poetry'],[/essay/i,'Essays'],[/horror/i,'Horror'],
  ];
  return [...new Set(candidates.filter(([pattern])=>pattern.test(text)).map(([,label])=>label))].slice(0,2);
}

const cleanSubjectValue=(value:any)=>{
  let subject=String(value||'').replace(/[_-]+/g,' ').trim();
  if(!subject)return '';
  const prefixed=subject.match(/^([a-z][a-z\s-]{1,24})\s*:\s*(.+)$/i);
  if(prefixed){
    const prefix=prefixed[1].trim().toLowerCase();
    const remainder=prefixed[2].trim();
    // Open Library and other catalogs sometimes mix relationship/taxonomy metadata
    // into their subject arrays. Those values are not genres and should never leak
    // into the reader-facing UI. Keep true category/genre prefixes, strip the rest.
    if(['series','subject','subjects','topic','topics','person','people','place','places','time','times'].includes(prefix))return '';
    if(['genre','genres','category','categories'].includes(prefix))subject=remainder;
    else return '';
  }
  if(/^series\s*(?:[-:=]|\b)/i.test(subject))return '';
  return subject.replace(/\s+/g,' ').trim();
};

const cleanSubjects=(subjects:any[]) => (subjects||[])
  .map(cleanSubjectValue)
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


export async function findBestBookCover(book:{title:string;author:string;isbn?:string}):Promise<string|undefined>{
  const title=book.title.trim(),author=book.author.trim();
  const norm=(v:string)=>v.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const stripSeries=(v:string)=>v
    .replace(/\s*[\[(][^\])]*(?:#\s*\d+|book\s*\d+|series|duet|trilogy|saga)[^\])]*[\])]\s*$/i,'')
    .replace(/\s*[-–—:]\s*(?:book\s*)?#?\d+\s*$/i,'')
    .trim()||v.trim();
  const authorVariants=(v:string)=>{
    const raw=v.trim();
    const variants=[raw];
    if(raw.includes(',')){
      const parts=raw.split(',').map(x=>x.trim()).filter(Boolean);
      if(parts.length>=2)variants.push(`${parts.slice(1).join(' ')} ${parts[0]}`);
    }
    return [...new Set(variants.map(norm).filter(Boolean))];
  };
  const baseTitle=stripSeries(title),titleKeys=[...new Set([norm(title),norm(baseTitle)].filter(Boolean))];
  const authorKeys=authorVariants(author);
  const cleanIsbn=String(book.isbn||'').replace(/[^0-9X]/gi,'');
  const titleScore=(candidate:string)=>{
    const key=norm(candidate);
    let best=0;
    for(const target of titleKeys){
      if(key===target)best=Math.max(best,120);
      else if(key.startsWith(target)||target.startsWith(key))best=Math.max(best,88);
      else if(key.includes(target)||target.includes(key))best=Math.max(best,70);
    }
    return best;
  };
  const authorScore=(candidate:string)=>{
    const key=norm(candidate);
    let best=0;
    for(const target of authorKeys){
      if(key===target)best=Math.max(best,60);
      else if(key.includes(target)||target.includes(key))best=Math.max(best,42);
      else{
        const a=new Set(key.split(' ').filter(Boolean)),b=new Set(target.split(' ').filter(Boolean));
        const overlap=[...b].filter(x=>a.has(x)).length;
        if(overlap>=2)best=Math.max(best,30);
      }
    }
    return best;
  };
  const googleCover=(links:any)=>{
    const raw=links?.extraLarge||links?.large||links?.medium||links?.small||links?.thumbnail||links?.smallThumbnail;
    return raw?String(raw).replace('http://','https://').replace('&zoom=1','&zoom=2'):undefined;
  };

  const openQueries:URLSearchParams[]=[];
  if(book.isbn)openQueries.push(new URLSearchParams({isbn:book.isbn,limit:'18',fields:'title,author_name,cover_i,isbn'}));
  for(const candidateTitle of [...new Set([title,baseTitle])]){
    const params=new URLSearchParams({title:candidateTitle,author,limit:'24',fields:'title,author_name,cover_i,isbn'});
    openQueries.push(params);
  }
  try{
    for(const params of openQueries){
      const r=await fetch(`https://openlibrary.org/search.json?${params}`);
      if(!r.ok)continue;
      const data=await r.json();
      const ranked=(data.docs||[]).filter((d:any)=>d.cover_i).map((d:any)=>{
        const ids=(d.isbn||[]).map((x:any)=>String(x||'').replace(/[^0-9X]/gi,''));
        const exactIsbn=Boolean(cleanIsbn&&ids.includes(cleanIsbn));
        const score=(exactIsbn?180:0)+titleScore(String(d.title||''))+authorScore((d.author_name||[]).join(' '));
        return{d,score,exactIsbn};
      }).filter((x:any)=>x.exactIsbn||x.score>=105).sort((a:any,b:any)=>b.score-a.score);
      if(ranked[0]?.d?.cover_i)return `https://covers.openlibrary.org/b/id/${ranked[0].d.cover_i}-L.jpg`;
    }
  }catch{}

  try{
    const queryAuthors=[author];
    if(author.includes(',')){
      const parts=author.split(',').map(x=>x.trim()).filter(Boolean);
      if(parts.length>=2)queryAuthors.push(`${parts.slice(1).join(' ')} ${parts[0]}`);
    }
    const queries=[
      book.isbn?`isbn:${book.isbn}`:'',
      ...[...new Set([title,baseTitle])].flatMap(t=>queryAuthors.flatMap(a=>[
        [`intitle:${t}`,a?`inauthor:${a}`:''].filter(Boolean).join(' '),
        [t,a].filter(Boolean).join(' '),
        `"${t}" ${a}`.trim(),
      ])),
    ].filter((q,i,a)=>q&&a.indexOf(q)===i);
    for(const q of queries){
      const r=await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=30&printType=books`);
      if(!r.ok)continue;
      const data=await r.json();
      const ranked=(data.items||[]).map((item:any)=>{
        const v=item.volumeInfo||{},authors=(v.authors||[]).map(String);
        const ids=(v.industryIdentifiers||[]).map((x:any)=>String(x.identifier||'').replace(/[^0-9X]/gi,''));
        const exactIsbn=Boolean(cleanIsbn&&ids.includes(cleanIsbn));
        let score=(exactIsbn?190:0)+titleScore(String(v.title||''))+authorScore(authors.join(' '));
        if(v.pageCount)score+=4;
        if(googleCover(v.imageLinks))score+=20;
        return{v,score,exactIsbn};
      }).filter((x:any)=>googleCover(x.v.imageLinks)&&(x.exactIsbn||x.score>=112)).sort((a:any,b:any)=>b.score-a.score);
      const cover=googleCover(ranked[0]?.v?.imageLinks);
      if(cover)return cover;
    }
  }catch{}
  return undefined;
}

export type ChapterMetadata = { count?: number; source: 'openlibrary_toc' | 'none' };

export async function getKnownChapterMetadata(book:{title:string;author:string;isbn?:string}):Promise<ChapterMetadata>{
  try{
    const q=book.isbn?`isbn:${book.isbn}`:`title:${book.title} author:${book.author}`;
    const search=await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=3&fields=key`);
    if(!search.ok)return {source:'none'};
    const data=await search.json();
    const key=data.docs?.find((d:any)=>String(d.key||'').startsWith('/works/'))?.key;
    if(!key)return {source:'none'};
    const work=await fetch(`https://openlibrary.org${key}.json`);
    if(!work.ok)return {source:'none'};
    const json=await work.json();
    const toc=Array.isArray(json.table_of_contents)?json.table_of_contents:[];
    if(toc.length<2)return {source:'none'};
    const chapterish=toc.filter((entry:any)=>{
      const label=String(entry?.title||entry?.label||'').trim();
      if(!label)return false;
      return !/^(contents|acknowledg|copyright|bibliograph|index|notes|about the author)$/i.test(label);
    });
    const count=chapterish.length||toc.length;
    return count>=2&&count<=180?{count,source:'openlibrary_toc'}:{source:'none'};
  }catch{return {source:'none'}}
}

export async function getKnownChapterCount(book:{title:string;author:string;isbn?:string}):Promise<number|undefined>{
  return (await getKnownChapterMetadata(book)).count;
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
  [/coming of age|young adult|youth|school|student/i,'growing up'],
  [/magic|wizard|witch|fantasy|supernatural|ghost|monster|vampire/i,'magic & the unknown'],
  [/good and evil|morality|moral|courage|bravery|choice/i,'choices & courage'],
  [/essay|essays/i,'ideas & observation'],
  [/memoir|biograph/i,'life & memory'],
];

function discussionSentence(book:BookDecisionDetails,topics:string[],text:string){
  if(topics.length>=2)return `Your group can dig into ${topics[0]} and ${topics[1]}, especially where different readers interpret the characters' choices or the world of the book differently.`;
  if(topics.length===1)return `A natural conversation is ${topics[0]}: what the book seems to be saying about it, and where readers may disagree.`;
  const source=`${book.title} ${book.description||''} ${text}`;
  if(/fantasy|magic|wizard|witch|ghost|monster|vampire|supernatural/i.test(source))return 'There is plenty to discuss around how the book builds its world, who belongs in it, and how its characters respond to fear, power, loyalty, and the unknown.';
  if(/school|child|children|young|student|coming of age/i.test(source))return 'The group can compare how the book handles growing up, belonging, friendship, and the choices its younger characters are asked to make.';
  if(/mystery|thriller|crime|detective|murder/i.test(source))return 'Expect theories about motive, clues, credibility, and which details different readers noticed or interpreted differently.';
  if(book.description)return 'The strongest discussion will come from comparing reactions to the characters’ choices, the book’s central tensions, and what different readers think it is ultimately trying to say.';
  return '';
}

export function buildLocalDecisionGuide(book:BookDecisionDetails){
  const text=book.subjects.join(' · ');
  const topicSource=`${text} · ${book.description||''} · ${book.title}`;
  const topics=topicRules.filter(([r])=>r.test(topicSource)).map(([,label])=>label).filter((x,i,a)=>a.indexOf(x)===i).slice(0,4);
  const pages=book.pages;
  const hours=pages?Math.max(2,Math.round(pages/32)):undefined;
  const weekly=pages?Math.ceil(pages/4):undefined;
  const commitment=pages
    ? pages<240?`Pretty manageable for a month: about ${hours} hours total, or roughly ${weekly} pages a week.`
      : pages<420?`A medium commitment: about ${hours} hours total, or roughly ${weekly} pages a week over a month.`
      : `A bigger month: around ${hours} hours total. Better if everyone is up for roughly ${weekly} pages a week.`
    : 'Page count varies by edition, so check the copy everyone is likely to use before setting the month.';
  const shape=/essay/i.test(text)?'essay collection':/memoir|biograph/i.test(text)?'memoir / nonfiction':/short stories/i.test(text)?'short-story collection':/poetry/i.test(text)?'poetry':/fiction|novel/i.test(text)?'novel':'book';
  const discussion=discussionSentence(book,topics,text);
  const fit=/mystery|thriller|crime/i.test(text)?'Good if your group likes theories, motives, and comparing what everyone noticed.'
    :/essay/i.test(text)?'Good if your group wants a flexible month: people can discuss individual pieces even if they read at slightly different speeds.'
    :/memoir|biograph/i.test(text)?'Good if your group likes talking about choices, perspective, memory, and how a life gets narrated.'
    :'Good if your group wants a book where interpretation and reactions can carry the conversation, not just plot recap.';
  return {shape,commitment,discussion,fit,topics:topics.length?topics:book.subjects.slice(0,4).map(s=>s.toLowerCase())};
}
