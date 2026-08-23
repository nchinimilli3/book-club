export type Depth='short'|'medium'|'deep';
export function DepthSwitch({value,onChange}:{value:Depth;onChange:(d:Depth)=>void}){
 return <div className="depth-switch" role="group" aria-label="Reading depth">
  <button className={value==='short'?'active':''} onClick={()=>onChange('short')}>30 sec</button>
  <button className={value==='medium'?'active':''} onClick={()=>onChange('medium')}>2 min</button>
  <button className={value==='deep'?'active':''} onClick={()=>onChange('deep')}>Deep dive</button>
 </div>
}
