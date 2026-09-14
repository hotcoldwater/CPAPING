import {requireUser,supabase} from '../../_shared.js';
import {reply} from '../../_career.js';
export async function onRequestGet({request,env}) {try{const user=await requireUser(request,env);if(!user)return reply({error:'unauthorized'},401);const rows=await supabase(env,`profiles?user_id=eq.${user.id}&select=nickname`);return reply({nickname:rows[0]?.nickname||null});}catch{return reply({error:'unavailable'},503);}}
