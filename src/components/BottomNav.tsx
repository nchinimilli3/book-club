import { Home, Users, Search, UserRound } from 'lucide-react';
export type Tab = 'home'|'clubs'|'search'|'profile';
export function BottomNav({tab,setTab}:{tab:Tab; setTab:(t:Tab)=>void}) {
  const items:[Tab,string,any][] = [['home','Home',Home],['clubs','Clubs',Users],['search','Search',Search],['profile','Profile',UserRound]];
  return <nav className="bottom-nav" aria-label="Primary">
    {items.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={20}/><span>{label}</span></button>)}
  </nav>
}
