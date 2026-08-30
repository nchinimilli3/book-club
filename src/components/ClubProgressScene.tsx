import { useMemo, type CSSProperties } from 'react';
import type { Member, ProgressScene } from '../lib/model';
import { Avatar } from './SafeImage';

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

function place(member:Member){
  if(member.status==='finished')return 'Finished';
  if(member.status==='dnf')return 'Not finishing';
  if(member.format==='page'&&member.page!=null)return `Page ${member.page}`;
  if(member.format==='percent'&&member.percent!=null)return `${Math.round(Number(member.percent))}%`;
  if(member.format==='chapter'&&member.chapter!=null)return `Chapter ${member.chapter}`;
  if(member.chapter!=null)return `Chapter ${member.chapter}`;
  if(member.page!=null)return `Page ${member.page}`;
  if(member.percent!=null)return `${Math.round(Number(member.percent))}%`;
  return 'Not started';
}

/** One source of truth for every progress visualization. */
export function getMemberReadingProgress(member:Member,totalChapters:number,totalPages:number){
  if(member.status==='finished')return 1;
  if(member.status==='dnf')return 0;
  const format=member.format;
  if(format==='page'&&member.page!=null&&totalPages>0)return clamp01(member.page/totalPages);
  if(format==='percent'&&member.percent!=null)return clamp01(Number(member.percent)/100);
  if(format==='chapter'&&member.chapter!=null&&totalChapters>0)return clamp01(member.chapter/totalChapters);
  if(member.chapter!=null&&totalChapters>0)return clamp01(member.chapter/totalChapters);
  if(member.page!=null&&totalPages>0)return clamp01(member.page/totalPages);
  if(member.percent!=null)return clamp01(Number(member.percent)/100);
  return 0;
}

export function ClubProgressScene({members,currentUserId,currentUserProgress,totalChapters=0,totalPages=0,scene:_scene,onOpenMember}:Props){
  const rows=useMemo(()=>members.map(member=>member.id===currentUserId&&currentUserProgress
    ? {...member,...currentUserProgress}
    : member),[members,currentUserId,currentUserProgress]);

  return <section className="club-progress-scene progress-mode-bars">
    <header className="club-progress-head">
      <div><p>Reading together</p><h3>The club’s progress</h3></div>
      <span className="club-progress-destination">Finish</span>
    </header>

    <div className="club-progress-list">
      {rows.map(member=>{
        const progress=getMemberReadingProgress(member,totalChapters,totalPages);
        const label=place(member);
        return <div className={`club-progress-row${member.id===currentUserId?' is-you':''}`} key={member.id}>
          <button
            type="button"
            className="club-progress-member"
            onClick={()=>onOpenMember(member.id)}
            aria-label={`Open ${member.displayName}, ${label}`}
          >
            <span className="club-progress-avatar"><Avatar src={member.avatarUrl} name={member.displayName}/></span>
            <span className="club-progress-person-copy"><b>{member.id===currentUserId?`${member.displayName} (you)`:member.displayName}</b><small>{label}</small></span>
          </button>
          <div className="club-progress-track" role="progressbar" aria-label={`${member.displayName}: ${Math.round(progress*100)}% complete`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress*100)}>
            <i style={{'--member-progress':`${progress*100}%`} as CSSProperties}/>
            <span style={{'--member-progress':`${progress*100}%`} as CSSProperties}/>
          </div>
          <strong className="club-progress-percent">{member.status==='finished'?'Done':`${Math.round(progress*100)}%`}</strong>
        </div>
      })}
    </div>
  </section>
}
