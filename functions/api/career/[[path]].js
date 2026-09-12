import {identity,reply,fail,body,textValue,uuid,owned,patch,insert,enqueue,enc,now,supabase,seal,unseal,provider,callback,random,base64,validateProfile,validateFilters} from '../../_career.js';

async function oauthCallback(request,env) {
  const returnTo=env.CAREER_MAIL_ONLY==='true'?'/mail-connect/':'/apply/';
  const finish=result=>new Response(null,{status:303,headers:{Location:returnTo+'?mail='+result,'Set-Cookie':'career_oauth=; Max-Age=0; Path=/api/career; Secure; HttpOnly; SameSite=Lax','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  const u=new URL(request.url),state=u.searchParams.get('state');
  const cookie=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)career_oauth=([^;]+)/)?.[1];
  if(!state||state!==cookie||!/^[\w-]{43}$/.test(state)) throw fail('메일 연결 확인 시간이 지났습니다. 다시 연결해 주세요.');
  // DELETE RETURNING으로 동시에 온 callback도 한 번만 소비.
  const states=await supabase(env,`career_oauth_states?id=eq.${enc(state)}&expires_at=gt.${enc(now())}`,{method:'DELETE',headers:{Prefer:'return=representation'}});
  const saved=states?.[0]; if(!saved) throw fail('메일 연결을 다시 시작해 주세요.');
  if(u.searchParams.has('error')) return finish('cancelled');
  const p=provider(env,saved.provider),verifier=await unseal(env,saved.user_id,saved.verifier_encrypted);
  const res=await fetch(p.token,{method:'POST',body:new URLSearchParams({client_id:p.client,client_secret:p.secret,code:u.searchParams.get('code')||'',redirect_uri:callback(env),grant_type:'authorization_code',code_verifier:verifier})});
  if(!res.ok) throw fail('메일 서비스가 연결을 승인하지 않았습니다. 다시 연결해 주세요.',502);
  const tokens=await res.json();
  const scopes=new Set(String(tokens.scope||'').split(/\s+/));
  const canSend=p.id==='google'?scopes.has('https://www.googleapis.com/auth/gmail.send'):[...scopes].some(s=>['mail.send','https://graph.microsoft.com/mail.send'].includes(s.toLowerCase()));
  // 동의 여부와 갱신 토큰 발급을 구분한다. 불완전한 토큰은 저장하지 않는다.
  if(!canSend) return finish('missing_send_permission');
  if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token.trim()) return finish('missing_refresh_token');
  const profileResponse=await fetch(p.profile,{headers:{Authorization:`Bearer ${tokens.access_token}`}});
  if(!profileResponse.ok) throw fail('발신 계정을 확인하지 못했습니다.',502);
  const info=await profileResponse.json();
  const email=p.id==='google'?(info.email_verified?info.email:null):(info.mail||info.userPrincipalName);
  if(!email||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('발신 이메일을 확인하지 못했습니다.');
  await supabase(env,'career_mail_accounts?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({user_id:saved.user_id,provider:p.id,email,token_encrypted:await seal(env,saved.user_id,tokens.refresh_token),connected_at:now()})});
  return finish('connected');
}

export async function onRequest({request,env,params}) {
  try {
    const path=Array.isArray(params.path)?params.path.join('/'):params.path||'';
    if(path==='mail-callback'&&request.method==='GET') { if(env.CAREER_ENABLED!=='true') throw fail('메일 연결 준비 중입니다.',503); return await oauthCallback(request,env); }
    if(env.CAREER_MAIL_ONLY==='true'&&!['GET state','POST mail-connect','DELETE mail'].includes(request.method+' '+path)) throw fail('현재는 개인 메일 연결·해제만 테스트할 수 있습니다.',503);
    const user=await identity(request,env),uid=enc(user.id),method=request.method;
    if(path==='state'&&method==='GET') {
      if(env.CAREER_MAIL_ONLY==='true') {
        const mail=await supabase(env,`career_mail_accounts?user_id=eq.${uid}&select=provider,email,connected_at`);
        return reply({mail_only:true,mail:mail[0]||null,providers:{google:!!(env.GOOGLE_MAIL_CLIENT_ID&&env.GOOGLE_MAIL_CLIENT_SECRET&&env.MAIL_TOKEN_KEY)}});
      }
      const [profiles,rules,mail,jobs,apps,files]=await Promise.all([
        supabase(env,`career_profiles?user_id=eq.${uid}`),supabase(env,`career_rules?user_id=eq.${uid}`),
        supabase(env,`career_mail_accounts?user_id=eq.${uid}&select=provider,email,connected_at`),
        supabase(env,`career_jobs?user_id=eq.${uid}&select=id,kind,status,result,error,created_at&order=created_at.desc&limit=30`),
        supabase(env,`career_applications?user_id=eq.${uid}&order=created_at.desc&limit=100`),
        supabase(env,`career_files?user_id=eq.${uid}&kind=eq.template&select=id,name,created_at,mapping,verified_at,verified_company&order=created_at.desc&limit=20`)]);
      return reply({ai_provider:env.CAREER_AI_PROVIDER==='openai'?'OpenAI':'Kimi',profile:profiles[0]||{data:{},version:0},rule:rules[0]||null,mail:mail[0]||null,jobs,applications:apps,templates:files,
        providers:{google:!!(env.GOOGLE_MAIL_CLIENT_ID&&env.GOOGLE_MAIL_CLIENT_SECRET&&env.MAIL_TOKEN_KEY),microsoft:!!(env.MICROSOFT_MAIL_CLIENT_ID&&env.MICROSOFT_MAIL_CLIENT_SECRET&&env.MAIL_TOKEN_KEY)}});
    }
    if(path==='profile'&&method==='PUT') {
      const input=await body(request),data=validateProfile(input.data);
      if(!Number.isInteger(input.version)||input.version<0) throw fail('저장 버전을 확인해 주세요.');
      let rows;
      if(input.version===0) {
        try { rows=await insert(env,'career_profiles',{user_id:user.id,data}); }
        catch(e) { if(/409|23505/.test(e.message)) throw fail('다른 창에서 저장한 내용이 있습니다. 새로고침 후 확인해 주세요.',409); throw e; }
      } else rows=await patch(env,'career_profiles',`user_id=eq.${uid}&version=eq.${input.version}`,{data,version:input.version+1,updated_at:now()});
      if(!rows?.length) throw fail('다른 창에서 저장한 내용이 있습니다. 새로고침 후 확인해 주세요.',409);
      // 작성 내용을 바꾼 뒤에는 기존 자동 발송 동의를 다시 확인한다.
      await patch(env,'career_rules',`user_id=eq.${uid}&mode=eq.auto`,{enabled:false,updated_at:now()});
      await patch(env,'career_applications',`user_id=eq.${uid}&status=eq.queued`,{status:'review',reason:'작성 자료가 변경되었습니다. 내용을 다시 검수해 주세요.',updated_at:now()});
      return reply(rows[0]);
    }
    if(path==='jobs'&&method==='POST') {
      const b=await body(request),kind=b.kind;
      if(!['assist','essay','export','inspect'].includes(kind)) throw fail('작업 종류를 확인해 주세요.');
      const profiles=await supabase(env,`career_profiles?user_id=eq.${uid}`),profile=profiles[0];
      if(!profile) throw fail('작성 자료를 먼저 저장해 주세요.');
      if(['assist','essay'].includes(kind)&&(profile.data.ai_consent!==true||profile.data.ai_consent_provider!==(env.CAREER_AI_PROVIDER||'kimi'))) throw fail('AI 처리에 동의한 뒤 이용해 주세요.');
      const input={profile:profile.data,profile_version:profile.version,prompt:textValue(b.prompt||'',4000),section:textValue(b.section||'',80),format:b.format==='pdf'?'pdf':'docx'};
      if(kind==='inspect') { const f=await owned(env,'career_files',user.id,b.template_id,'id,kind'); if(f.kind!=='template')throw fail('지원 양식을 선택해 주세요.'); input.template_id=f.id; }
      return reply(await enqueue(env,user.id,kind,input),202);
    }
    if(path==='rules'&&method==='PUT') {
      if(!(await supabase(env,`career_profiles?user_id=eq.${uid}&select=user_id`))[0])throw fail('자소서 화면에서 작성 자료를 먼저 저장해 주세요.');
      const b=await body(request),filters=validateFilters(b.filters);
      if(!['review','auto'].includes(b.mode)||!Number.isInteger(b.daily_limit)||b.daily_limit<1||b.daily_limit>20) throw fail('발송 방식과 하루 한도를 확인해 주세요.');
      if(b.enabled===true&&b.mode==='auto') {
        const p=(await supabase(env,`career_profiles?user_id=eq.${uid}`))[0];
        const m=(await supabase(env,`career_mail_accounts?user_id=eq.${uid}&select=email`))[0];
        if(!m||!p?.data.facts_confirmed||!p.data.essay||b.consent_version!=='auto-v1') throw fail('메일 연결, 사실 확인, 최종 자소서와 자동 발송 동의가 필요합니다.');
      }
      if(b.template_id) {
        const template=await owned(env,'career_files',user.id,b.template_id,'id,kind,verified_at');
        if(template.kind!=='template'||!template.verified_at||filters.firms.length!==1)throw fail('검수한 지정 양식은 한 곳의 관심 법인에만 연결할 수 있습니다.');
      }
      const data={template_id:b.template_id||null,user_id:user.id,enabled:b.enabled===true,mode:b.mode,filters,daily_limit:b.daily_limit,consent_version:b.mode==='auto'?b.consent_version:null,enabled_since:now(),updated_at:now()};
      await supabase(env,'career_rules?on_conflict=user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify(data)});
      // 조건 변경 이전에 준비한 자동 발송은 새 조건으로 재검수.
      await patch(env,'career_applications',`user_id=eq.${uid}&status=eq.queued&origin=eq.rule`,{status:'review',reason:'자동지원 조건이 변경되었습니다.',updated_at:now()});
      return reply(data);
    }
    if(path==='mail-connect'&&method==='POST') {
      const b=await body(request),p=provider(env,b.provider);
      if(env.CAREER_MAIL_ONLY==='true'&&p.id!=='google') throw fail('현재는 Gmail 연결을 테스트하고 있습니다.',503);
      if(!p.client||!p.secret||!env.MAIL_TOKEN_KEY) throw fail('이 메일 서비스의 연결 설정을 준비 중입니다.',503);
      const state=random(),verifier=random();
      const challenge=base64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      await supabase(env,`career_oauth_states?user_id=eq.${uid}`,{method:'DELETE'});
      await insert(env,'career_oauth_states',{id:state,user_id:user.id,provider:p.id,verifier_encrypted:await seal(env,user.id,verifier)});
      const query=new URLSearchParams({client_id:p.client,redirect_uri:callback(env),response_type:'code',scope:p.scope,state,code_challenge:challenge,code_challenge_method:'S256',prompt:p.id==='google'?'consent':'select_account'});
      if(p.id==='google')query.set('access_type','offline');
      const r=reply({url:p.authorize+'?'+query});
      r.headers.set('Set-Cookie',`career_oauth=${state}; Max-Age=600; Path=/api/career; Secure; HttpOnly; SameSite=Lax`); return r;
    }
    if(path==='mail'&&method==='DELETE') {
      await patch(env,'career_rules',`user_id=eq.${uid}`,{enabled:false,updated_at:now()});
      await patch(env,'career_applications',`user_id=eq.${uid}&status=eq.queued`,{status:'review',reason:'메일 연결이 해제되었습니다.',updated_at:now()});
      // 로컬 토큰 삭제가 우선. Google 권한도 철회하며, Microsoft 철회 링크는 UI 안내.
      const m=(await supabase(env,`career_mail_accounts?user_id=eq.${uid}`))[0];
      await supabase(env,`career_mail_accounts?user_id=eq.${uid}`,{method:'DELETE'});
      await supabase(env,`career_oauth_states?user_id=eq.${uid}`,{method:'DELETE'});
      if(m?.provider==='google') {
        try { const token=await unseal(env,user.id,m.token_encrypted); await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token})}); } catch { /* 삭제한 토큰은 다시 사용하지 않는다. */ }
      }
      return reply({ok:true});
    }
    if(path==='templates'&&method==='POST') {
      if(!(await supabase(env,`career_profiles?user_id=eq.${uid}&select=user_id`))[0])throw fail('자소서 화면에서 작성 자료를 먼저 저장해 주세요.');
      const b=await body(request,4100000),name=textValue(b.name,100),data=b.data_base64;
      if(!/\.(docx|pdf)$/i.test(name)||typeof data!=='string'||data.length>4000000||!/^[-A-Za-z0-9+/]*={0,2}$/.test(data)) throw fail('3MB 이하의 DOCX·PDF 파일을 선택해 주세요.');
      const rows=await supabase(env,`career_files?user_id=eq.${uid}&kind=eq.template&select=id`);
      if(rows.length>=20)throw fail('양식은 20개까지 보관합니다.');
      const mime=/\.pdf$/i.test(name)?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      return reply((await insert(env,'career_files',{user_id:user.id,name,mime,data_base64:data,kind:'template'})).map(f=>({id:f.id,name:f.name}))[0],201);
    }
    if(path.startsWith('templates/')&&method==='PUT') {
      const id=uuid(path.split('/')[1]),file=await owned(env,'career_files',user.id,id,'id,kind');
      const b=await body(request),mapping=b.mapping;
      if(file.kind!=='template'||!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).length>200)throw fail('양식 항목 대응을 확인해 주세요.');
      const allowed=['full_name','email','phone','address','education','career','certifications','target_firm','target_role','essay'];
      if(Object.entries(mapping).some(([k,v])=>k.length>200||!allowed.includes(v)))throw fail('양식 항목을 확인해 주세요.');
      return reply((await patch(env,'career_files',`user_id=eq.${uid}&id=eq.${id}`,{mapping,verified_mapping:null,verified_company:null,verified_at:null}))[0]?.id ? {ok:true} : {ok:false});
    }
    if(path.startsWith('files/')&&method==='GET') {
      const f=await owned(env,'career_files',user.id,path.split('/')[1]);
      return new Response(Uint8Array.from(atob(f.data_base64),c=>c.charCodeAt(0)),{headers:{'Content-Type':f.mime,'Content-Disposition':`attachment; filename*=UTF-8''${enc(f.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(path==='applications'&&method==='POST') {
      if(!(await supabase(env,`career_profiles?user_id=eq.${uid}&select=user_id`))[0])throw fail('자소서 화면에서 작성 자료를 먼저 저장해 주세요.');
      const b=await body(request),pid=String(b.posting_id||''); if(!/^\d{1,15}$/.test(pid)) throw fail('공고를 선택해 주세요.');
      const post=(await supabase(env,`job_postings?id=eq.${pid}`))[0];
      if(!post||post.is_expired||post.removed_at)throw fail('현재 지원 가능한 공고가 아닙니다.');
      const app=(await insert(env,'career_applications',{user_id:user.id,posting_id:post.id,canonical_posting_id:post.original_id||post.id,origin:'manual'}))[0];
      try { await enqueue(env,user.id,'prepare',{application_id:app.id}); }
      catch(e) { await patch(env,'career_applications',`id=eq.${app.id}`,{status:'blocked',reason:'준비 작업을 시작하지 못했습니다. 다시 준비를 눌러 주세요.'}); throw e; }
      return reply(app,202);
    }
    if(path.startsWith('applications/')&&method==='PUT') {
      const id=uuid(path.split('/')[1]),a=await owned(env,'career_applications',user.id,id),b=await body(request);
      if(!['review','blocked','failed','preparing','queued'].includes(a.status))throw fail('이미 발송 중이거나 완료된 지원서는 변경할 수 없습니다.',409);
      if(a.version!==b.version)throw fail('지원서가 변경되었습니다. 새로고침 후 다시 확인해 주세요.',409);
      const data={updated_at:now(),version:a.version+1};
      if(b.action==='cancel') {data.status='cancelled';data.reason='사용자가 취소했습니다.';}
      else if(b.action==='prepare') {
        if(a.status==='queued')throw fail('발송 대기를 취소한 뒤 다시 준비해 주세요.');
        if(b.template_id) {const f=await owned(env,'career_files',user.id,b.template_id,'id,kind');if(f.kind!=='template')throw fail('지원 양식을 선택해 주세요.');data.template_id=b.template_id;}
        data.status='preparing';data.reason=null;
      }
      else if(b.action==='approve') {
        if(a.status!=='review'||!a.document_id||!a.recipient||b.reviewed!==true)throw fail('받는 사람·본문·첨부파일을 모두 확인해 주세요.');
        const mail=(await supabase(env,`career_mail_accounts?user_id=eq.${uid}&select=email`))[0];if(!mail)throw fail('개인 메일을 먼저 연결해 주세요.');
        data.subject=textValue(b.subject,200);data.body=textValue(b.body,10000);
        if(!data.subject||!data.body||/[\r\n]/.test(data.subject))throw fail('메일 제목과 내용을 확인해 주세요.');
        data.status='queued';data.approved_at=now();data.reason=null;data.snapshot={...a.snapshot};delete data.snapshot.auto_rule_updated_at;
      } else throw fail('작업을 확인해 주세요.');
      const rows=await patch(env,'career_applications',`user_id=eq.${uid}&id=eq.${id}&version=eq.${a.version}&status=eq.${a.status}`,data);
      if(!rows?.length)throw fail('지원서가 변경되었습니다. 새로고침 후 확인해 주세요.',409);
      if(b.action==='approve'&&a.template_id&&a.snapshot?.template_source_verified) {
        const f=await owned(env,'career_files',user.id,a.template_id);
        const normalized=v=>JSON.stringify(Object.entries(v||{}).sort(([a],[b])=>a.localeCompare(b)));
        if(normalized(f.mapping)===normalized(a.snapshot.template_mapping))await patch(env,'career_files',`user_id=eq.${uid}&id=eq.${a.template_id}`,{verified_mapping:f.mapping,verified_company:a.snapshot.company,verified_at:now()});
      }
      if(b.action==='prepare') {
        try { await enqueue(env,user.id,'prepare',{application_id:id}); }
        catch(e) {await patch(env,'career_applications',`id=eq.${id}&status=eq.preparing`,{status:'blocked',reason:'작업 한도에 도달했습니다. 잠시 후 다시 준비해 주세요.'});throw e;}
      }
      return reply(rows[0]);
    }
    if(path==='workspace'&&method==='DELETE') {
      const sending=await supabase(env,`career_applications?user_id=eq.${uid}&status=eq.sending&select=id`);
      if(sending.length)throw fail('메일 전송 중입니다. 결과를 확인한 뒤 삭제해 주세요.',409);
      // 계정은 유지하고 개인 작성 자료·토큰·지원 이력·문서를 삭제한다.
      for(const table of ['career_rules','career_mail_accounts','career_oauth_states','career_jobs','career_applications','career_files','career_profiles']) await supabase(env,`${table}?user_id=eq.${uid}`,{method:'DELETE'});
      return reply({ok:true});
    }
    return reply({error:'지원하지 않는 요청입니다.'},404);
  } catch(e) {
    if(e.status)return reply({error:e.message},e.status);
    if(/409|23505/.test(e.message))return reply({error:'이미 준비한 공고입니다. 지원함에서 확인해 주세요.'},409);
    console.error('career request failed',e.name); // API 응답·개인 자료·토큰은 로그 금지
    return reply({error:'처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'},500);
  }
}
