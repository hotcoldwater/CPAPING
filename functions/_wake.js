export async function wakeDelivery(env) {
  if(!env.CAREER_WAKE_URL||!env.CAREER_DISPATCH_SECRET)return false;
  try {
    const r=await fetch(env.CAREER_WAKE_URL,{method:'POST',headers:{Authorization:'Bearer '+env.CAREER_DISPATCH_SECRET},signal:AbortSignal.timeout(4000)});
    if(!r.ok)throw new Error('wake rejected');return true;
  }catch{console.warn('Immediate delivery wake unavailable; minute recovery will retry');return false;}
}
