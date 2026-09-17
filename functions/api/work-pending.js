import {supabase,reply} from '../_career.js';
export async function onRequest({request,env}){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!env.CAREER_DISPATCH_SECRET||request.headers.get('Authorization')!=='Bearer '+env.CAREER_DISPATCH_SECRET)return reply({error:'Unauthorized'},401);
 if(env.CAREER_RESUME_ENABLED!=='true')return reply({delivery:false,prepare:false,analysis:false});
 try{return reply(await supabase(env,'rpc/career_work_pending',{method:'POST',body:'{}'}));}
 catch{return reply({error:'Work check unavailable'},503);}
}
