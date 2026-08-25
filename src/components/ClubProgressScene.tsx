import { useMemo, type CSSProperties } from 'react';
import type { Member, ProgressScene } from '../lib/model';

type Props={
  members:Member[];
  currentUserId?:string;
  currentUserProgress?:Pick<Member,'chapter'|'page'|'percent'|'status'|'format'>;
  totalChapters?:number;
  totalPages?:number;
  scene:ProgressScene;
  onOpenMember:(memberId:string)=>void;
};

function clamp01(value:number){return Math.max(0,Math.min(1,value))}
function memberTone(seed:string){let h=0;for(let i=0;i<seed.length;i++)h=(h*33+seed.charCodeAt(i))>>>0;return h%5}

function place(member:Member){
  if(member.status==='finished')return 'Finished';
  if(member.status==='dnf')return 'Sitting this one out';
  if(member.format==='page'&&member.page!=null)return `p. ${member.page}`;
  if(member.format==='percent'&&member.percent!=null)return `${Math.round(Number(member.percent))}%`;
  if(member.format==='chapter'&&member.chapter!=null)return `Ch. ${member.chapter}`;
  if(member.chapter!=null)return `Ch. ${member.chapter}`;
  if(member.page!=null)return `p. ${member.page}`;
  if(member.percent!=null)return `${Math.round(Number(member.percent))}%`;
  return 'Not started';
}

/** One source of truth for both boat and car position. */
export function getMemberReadingProgress(member:Member,totalChapters:number,totalPages:number){
  if(member.status==='finished')return 1;
  if(member.status==='dnf')return 0;
  const format=member.format;
  if(format==='page'&&member.page!=null&&totalPages>0)return clamp01(member.page/totalPages);
  if(format==='percent'&&member.percent!=null)return clamp01(Number(member.percent)/100);
  if(format==='chapter'&&member.chapter!=null&&totalChapters>0)return clamp01(member.chapter/totalChapters);
  // Prefer the visible chapter/page value over a possibly stale stored percent.
  if(member.chapter!=null&&totalChapters>0)return clamp01(member.chapter/totalChapters);
  if(member.page!=null&&totalPages>0)return clamp01(member.page/totalPages);
  if(member.percent!=null)return clamp01(Number(member.percent)/100);
  return 0;
}

function makePreviewMember(index:number,totalChapters:number,totalPages:number):Member{
  const names=['Maya','Priya','Sam'];
  const normalized=[.8,.34,.14][index]??(.2+.18*index);
  const base:Member={id:`dev-preview-${index}`,displayName:names[index]||`Reader ${index+2}`,role:'preview'};
  if(totalChapters>0)return {...base,chapter:Math.max(1,Math.round(totalChapters*normalized)),format:'chapter'};
  if(totalPages>0)return {...base,page:Math.max(1,Math.round(totalPages*normalized)),format:'page'};
  return {...base,percent:Math.round(normalized*100),format:'percent'};
}

export function ClubProgressScene({members,currentUserId,currentUserProgress,totalChapters=0,totalPages=0,scene,onOpenMember}:Props){
  const rows=useMemo(()=>{
    const realMembers=members.map(member=>member.id===currentUserId&&currentUserProgress
      ? {...member,...currentUserProgress}
      : member);
    if(!import.meta.env.DEV||realMembers.length>=4)return realMembers;
    const next=[...realMembers];
    let previewIndex=0;
    while(next.length<4){next.push(makePreviewMember(previewIndex,totalChapters,totalPages));previewIndex+=1}
    return next;
  },[members,currentUserId,currentUserProgress,totalChapters,totalPages]);

  return <section className={`club-progress-scene progress-mode-${scene}`}>
    <header className="club-progress-head">
      <h3>The club’s progress right now</h3>
      <span className="club-progress-destination" aria-hidden="true">The End</span>
    </header>

    <div className="club-progress-list">
      {rows.map((member,index)=>{
        const progress=getMemberReadingProgress(member,totalChapters,totalPages);
        const label=place(member);
        const preview=member.role==='preview';
        const visualPosition=7+progress*86;
        return <div className="club-progress-row" key={member.id}>
          <button
            type="button"
            className={`club-progress-member${preview?' is-preview':''}`}
            onClick={()=>{if(!preview)onOpenMember(member.id)}}
            aria-disabled={preview||undefined}
            aria-label={preview?`${member.displayName}, ${label}`:`Open ${member.displayName}, ${label}`}
          >
            <span className="club-progress-avatar">{member.avatarUrl?<img src={member.avatarUrl} alt=""/>:member.displayName.slice(0,1)}</span>
            <span className="club-progress-person-copy"><b>{member.id===currentUserId?`${member.displayName} (you)`:member.displayName}</b></span>
          </button>

          <div className={`club-progress-environment club-progress-environment-${scene}`} aria-hidden="true" style={{'--lane-y':`${40+(index%4)*5}%`} as CSSProperties}>
            {scene==='race'?<>
              <div className="club-race-strip"/>
              <span className="club-race-finish"/>
              <span className={`club-progress-car car-${index%4}`} style={{'--vehicle-x':`${visualPosition}%`} as CSSProperties}/>
            </>:<>
              <div className="club-sailing-sky"/>
              <div className="club-sailing-water-row">
                <i className="wave-four"/><i className="wave-three"/><i className="wave-two"/><i className="wave-one"/>
              </div>
              <span className={`club-progress-boat boat-tone-${memberTone(member.id)}`} style={{'--vehicle-x':`${visualPosition}%`,'--delay':`${-(index*.53)}s`} as CSSProperties}/>
              {index===0&&<span className="club-sea-marker"><i/></span>}
            </>}
          </div>

          <span className="club-progress-place">{label}</span>
        </div>
      })}
    </div>
  </section>
}
