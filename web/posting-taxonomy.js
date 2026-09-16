/* Shared by the static/live detail renderer and the public list. */
(() => {
 const categoryLabels={entry_cpa:'신입 CPA',experienced_cpa:'경력 CPA',general:'일반 채용'};
 const workLabels={full_time:'풀타임',part_time:'파트타임',internship:'인턴십'};
 const boardLabels={cpa:'CPA',trainee:'수습CPA',general:'일반',association:'한국공인회계사회'};
 const categories=p=>Array.isArray(p.recruitment_categories)?p.recruitment_categories:[];
 const entryEligible=p=>categories(p).includes('entry_cpa');
 const labels=p=>{
  const values=(entryEligible(p)?['entry_cpa']:categories(p)).map(k=>categoryLabels[k]).filter(Boolean);
  if(p.company_type&&p.company_type!=='확인 필요')values.push(p.company_type);
  if(p.cpa_preferred)values.push('CPA 우대');
  return values;
 };
 const work=p=>(p.work_types||[]).map(k=>workLabels[k]).filter(Boolean).join(' · ')||({'Full Time':'풀타임','Part Time':'파트타임','Internship':'인턴십'}[p.employment_type]||p.employment_type||'');
 const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const closed=p=>!!(p.removed_at||p.is_expired||(p.deadline&&p.deadline<today())||/마감|완료|종료/.test(p.hiring_status||''));
 const normalized=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
 function groupPostings(posts){
  const byId=new Map(posts.map(p=>[String(p.id),p]));const groups=new Map();
  const same=(a,b)=>['company_name','work_region','employment_type'].every(k=>normalized(a[k])===normalized(b[k]))&&
   normalized(a.title)===normalized(b.title)&&JSON.stringify(a.contract_types||[])===JSON.stringify(b.contract_types||[]);
  for(const p of posts){
   const root=p.original_id&&byId.get(String(p.original_id));
   const key=root&&same(p,root)?'original:'+root.id:posts.some(o=>String(o.original_id)===String(p.id)&&same(o,p))?'original:'+p.id:
    p.content_hash?'hash:'+p.content_hash:'id:'+p.source+':'+p.ij_id;
   if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);
  }
  return [...groups.values()].map(rows=>{
   rows.sort((a,b)=>(b.posted_at||'').localeCompare(a.posted_at||'')||(b.first_seen_at||'').localeCompare(a.first_seen_at||''));
   return {...rows[0],history:rows.slice(1)};
  });
 }
 globalThis.cpPosting={categoryLabels,workLabels,boardLabels,categories,entryEligible,labels,work,closed,groupPostings};
})();
