const MAX_CAPTURE_EDGE=1800;
const CAPTURE_JPEG_QUALITY=.9;

export async function imageToDataUrl(file:File):Promise<string>{
  if(!file.type.startsWith('image/'))throw new Error('Choose a photo of the page.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(new Error('Could not read that image.'));el.src=url});
    const scale=Math.min(1,MAX_CAPTURE_EDGE/Math.max(img.naturalWidth,img.naturalHeight));
    const width=Math.max(1,Math.round(img.naturalWidth*scale)),height=Math.max(1,Math.round(img.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not prepare that image.');
    ctx.drawImage(img,0,0,width,height);
    return canvas.toDataURL('image/jpeg',CAPTURE_JPEG_QUALITY);
  }finally{URL.revokeObjectURL(url)}
}

export function normalizeAccent(r:number,g:number,b:number):[number,number,number]{
  let rf=r/255,gf=g/255,bf=b/255;
  const max=Math.max(rf,gf,bf),min=Math.min(rf,gf,bf),d=max-min;
  let h=0;
  if(d){
    if(max===rf)h=((gf-bf)/d)%6;
    else if(max===gf)h=(bf-rf)/d+2;
    else h=(rf-gf)/d+4;
    h*=60;if(h<0)h+=360;
  }
  let l=(max+min)/2;
  let s=d===0?0:d/(1-Math.abs(2*l-1));
  // Keep the cover's hue, but make muddy/dark source colors legible as a page identity color.
  s=Math.max(.38,Math.min(.68,s*1.22));
  l=Math.max(.34,Math.min(.48,l));
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
  let rr=0,gg=0,bb=0;
  if(h<60){rr=c;gg=x}else if(h<120){rr=x;gg=c}else if(h<180){gg=c;bb=x}else if(h<240){gg=x;bb=c}else if(h<300){rr=x;bb=c}else{rr=c;bb=x}
  return [Math.round((rr+m)*255),Math.round((gg+m)*255),Math.round((bb+m)*255)];
}

function rgbHue(r:number,g:number,b:number){
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  if(d<8)return -1;
  let h=max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4;
  h=(h*60+360)%360;return h;
}

type CoverPalette={accent:string;soft:string;rgb:string;colors:string[]};
const coverPaletteCache=new Map<string,Promise<CoverPalette>>();

export function coverAccent(src:string,seed:string):Promise<CoverPalette>{
  const fallback:CoverPalette={accent:'#6f6652',soft:'#f1eadc',rgb:'111,102,82',colors:['#5f86a8','#8f719d','#c06c54','#c49c37']};
  if(!src)return Promise.resolve(fallback);
  const cached=coverPaletteCache.get(src);if(cached)return cached;
  const palette=new Promise<CoverPalette>(resolve=>{
    const img=new Image();img.crossOrigin='anonymous';
    img.onload=()=>{try{
      const canvas=document.createElement('canvas');canvas.width=28;canvas.height=42;
      const ctx=canvas.getContext('2d');if(!ctx)return resolve(fallback);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const buckets=new Map<string,{r:number;g:number;b:number;n:number;sat:number}>();
      for(let i=0;i<data.length;i+=16){
        const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3],max=Math.max(r,g,b),min=Math.min(r,g,b);
        if(a<220||max>245&&min>226||max<28)continue;
        const sat=max-min;if(sat<18&&max>180)continue;
        const key=`${Math.round(r/32)}-${Math.round(g/32)}-${Math.round(b/32)}`;
        const v=buckets.get(key)||{r:0,g:0,b:0,n:0,sat:0};v.r+=r;v.g+=g;v.b+=b;v.n++;v.sat+=sat;buckets.set(key,v);
      }
      const ranked=[...buckets.values()].sort((a,b)=>((b.n*(1+b.sat/Math.max(1,b.n)/70))-(a.n*(1+a.sat/Math.max(1,a.n)/70))));
      if(!ranked.length)return resolve(fallback);
      const chosen:{color:string;hue:number}[]=[];
      for(const v of ranked){
        const raw=[Math.round(v.r/v.n),Math.round(v.g/v.n),Math.round(v.b/v.n)] as const;
        const hue=rgbHue(...raw);
        if(hue>=0&&chosen.some(x=>{const distance=Math.abs(x.hue-hue);return Math.min(distance,360-distance)<28}))continue;
        const [r,g,b]=normalizeAccent(...raw);chosen.push({color:`rgb(${r} ${g} ${b})`,hue});
        if(chosen.length===5)break;
      }
      const colors=chosen.map(x=>x.color);
      if(!colors.length)return resolve(fallback);
      const [r,g,b]=colors[0].match(/\d+/g)!.map(Number);
      resolve({accent:colors[0],soft:`rgba(${r}, ${g}, ${b}, .20)`,rgb:`${r},${g},${b}`,colors});
    }catch{resolve(fallback)}};
    img.onerror=()=>{const hue=Array.from(seed).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%360;resolve({...fallback,accent:`hsl(${hue} 34% 34%)`,colors:[`hsl(${hue} 34% 34%)`,...fallback.colors.slice(1)]})};
    img.src=src;
  });
  coverPaletteCache.set(src,palette);return palette;
}

function localInput(iso?:string){
  if(!iso)return '';
  const d=new Date(iso);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}

export function checkpointMeetingInputs(dueAt?:string){
  if(!dueAt)return ['','',''];
  const base=new Date(`${dueAt}T19:00:00`);
  const option=(dayOffset:number,hour:number)=>{
    const d=new Date(base);
    d.setDate(base.getDate()+dayOffset);
    d.setHours(hour,0,0,0);
    return localInput(d.toISOString());
  };
  return [option(-1,19),option(0,19),option(1,14)];
}

export function checkpointLabel(dueAt?:string){
  if(!dueAt)return 'Checkpoint discussion';
  return `Checkpoint on ${new Date(`${dueAt}T12:00`).toLocaleDateString('en-US',{month:'long',day:'numeric',weekday:'long'})}`;
}

export function checkpointTime(seed:string){
  return new Date(`${seed}T19:00:00`).getTime();
}

export function daysUntilDate(dueAt:string,now=new Date()){
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
  const due=new Date(`${dueAt}T12:00:00`);const dueDay=new Date(due.getFullYear(),due.getMonth(),due.getDate()).getTime();
  return Math.round((dueDay-today)/(24*60*60*1000));
}

export function daysRemainingLabel(days:number){
  if(days===0)return 'today';
  if(days===1)return 'tomorrow';
  if(days>1)return `in ${days} days`;
  if(days===-1)return 'yesterday';
  return `${Math.abs(days)} days ago`;
}

export function checkpointProgressPercent(checkpoint:{targetChapter?:number;targetPage?:number},totalChapters:number,totalPages:number){
  if(checkpoint.targetPage&&totalPages)return Math.max(0,Math.min(100,checkpoint.targetPage/totalPages*100));
  if(checkpoint.targetChapter&&totalChapters)return Math.max(0,Math.min(100,checkpoint.targetChapter/totalChapters*100));
  return undefined;
}

function checkpointPageTarget(checkpoint:{targetChapter?:number;targetPage?:number}|undefined,totalChapters:number,totalPages:number){
  if(!checkpoint)return 0;
  if(checkpoint.targetPage)return checkpoint.targetPage;
  if(checkpoint.targetChapter&&totalChapters&&totalPages)return Math.round(checkpoint.targetChapter/totalChapters*totalPages);
  return 0;
}

export function checkpointReadingMeta(checkpoint:{targetChapter?:number;targetPage?:number},previous:{targetChapter?:number;targetPage?:number}|undefined,totalChapters:number,totalPages:number){
  const startPage=checkpointPageTarget(previous,totalChapters,totalPages)+1;
  const endPage=checkpointPageTarget(checkpoint,totalChapters,totalPages);
  const pages=endPage>=startPage?endPage-startPage+1:0;
  const pageRange=pages?`${checkpoint.targetPage?'Pages':'Approx. pages'} ${startPage}–${endPage}`:'';
  const minutes=pages?Math.max(15,Math.round((pages/35*60)/5)*5):0;
  const readingTime=minutes?(minutes<60?`≈ ${minutes} min reading`:`≈ ${Math.floor(minutes/60)}h${minutes%60?` ${minutes%60}m`:''} reading`):'';
  return {startPage,endPage,pages,pageRange,minutes,readingTime};
}

export function checkpointPrepPrompts(checkpoint:{targetChapter?:number;targetPage?:number},previous:{targetChapter?:number;targetPage?:number}|undefined){
  if(checkpoint.targetChapter){
    const start=(previous?.targetChapter||0)+1,end=checkpoint.targetChapter,range=start===end?`Chapter ${end}`:`Chapters ${start}–${end}`;
    return [
      `What changed your read of a character in ${range}?`,
      `Which moment from ${range} would you bring to the group first?`,
      `What question are you carrying out of ${range}?`,
    ];
  }
  if(checkpoint.targetPage){
    const start=(previous?.targetPage||0)+1,end=checkpoint.targetPage,range=`pages ${start}–${end}`;
    return [
      `What idea or relationship shifted most across ${range}?`,
      `Which moment from ${range} is worth returning to together?`,
      `What question are you carrying into the next stretch?`,
    ];
  }
  return ['What stood out most in this stretch?','What changed your interpretation?','What do you want the group to debate?'];
}

function calendarStamp(date:Date){return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}
function calendarEscape(value:string){return value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
function allDayEnd(dueAt:string){const d=new Date(`${dueAt}T12:00:00`);d.setDate(d.getDate()+1);return d.toISOString().slice(0,10).replace(/-/g,'')}

export function readingPlanIcsHref(input:{clubName:string;bookTitle:string;checkpoints:Array<{id:string;dueAt:string;targetChapter?:number;targetPage?:number;label?:string}>;finishDate?:string;meeting?:{id:string;startsAt:string;meetingUrl?:string}}){
  const events:string[]=[];
  for(const checkpoint of input.checkpoints){
    const target=checkpoint.label|| (checkpoint.targetChapter?`Through Chapter ${checkpoint.targetChapter}`:checkpoint.targetPage?`Through page ${checkpoint.targetPage}`:'Reading checkpoint');
    const start=checkpoint.dueAt.replace(/-/g,'');
    events.push(['BEGIN:VEVENT',`UID:checkpoint-${checkpoint.id}@book-club`,`DTSTAMP:${calendarStamp(new Date())}`,`DTSTART;VALUE=DATE:${start}`,`DTEND;VALUE=DATE:${allDayEnd(checkpoint.dueAt)}`,`SUMMARY:${calendarEscape(`${input.bookTitle} · ${target}`)}`,`DESCRIPTION:${calendarEscape(`${input.clubName} reading checkpoint`)}`,'END:VEVENT'].join('\r\n'));
  }
  if(input.finishDate){
    events.push(['BEGIN:VEVENT',`UID:finish-${input.bookTitle.replace(/[^a-z0-9]/gi,'').slice(0,28)}@book-club`,`DTSTAMP:${calendarStamp(new Date())}`,`DTSTART;VALUE=DATE:${input.finishDate.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${allDayEnd(input.finishDate)}`,`SUMMARY:${calendarEscape(`${input.bookTitle} · Finish`)}`,`DESCRIPTION:${calendarEscape(`${input.clubName} finish target`)}`,'END:VEVENT'].join('\r\n'));
  }
  if(input.meeting){const start=new Date(input.meeting.startsAt),end=new Date(start.getTime()+90*60*1000);events.push(['BEGIN:VEVENT',`UID:meeting-${input.meeting.id}@book-club`,`DTSTAMP:${calendarStamp(new Date())}`,`DTSTART:${calendarStamp(start)}`,`DTEND:${calendarStamp(end)}`,`SUMMARY:${calendarEscape(`${input.clubName} · ${input.bookTitle}`)}`,input.meeting.meetingUrl?`LOCATION:${calendarEscape(input.meeting.meetingUrl)}`:'','END:VEVENT'].filter(Boolean).join('\r\n'))}
  const body=['BEGIN:VCALENDAR','VERSION:2.0','CALSCALE:GREGORIAN','PRODID:-//Book Club//Reading Plan//EN',...events,'END:VCALENDAR'].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

export function googleCheckpointHref(title:string,dueAt:string,details:string){
  const start=dueAt.replace(/-/g,''),end=allDayEnd(dueAt);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(details)}`;
}
