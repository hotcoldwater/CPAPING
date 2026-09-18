// Only server-configured user IDs grant access; editable user metadata is never trusted.
export function isCareerAdmin(user,env) {
  return !!user?.email_confirmed_at && String(env.CAREER_ADMIN_USER_IDS||'').split(',').map(v=>v.trim()).filter(Boolean).includes(user.id);
}
export function restrictCareerPath(path) {
  return /^(?:resume|application|deliveries(?:\/|$)|files(?:\/|$)|templates(?:\/|$)|jobs(?:\/|$)|rules(?:\/|$))/.test(path);
}
