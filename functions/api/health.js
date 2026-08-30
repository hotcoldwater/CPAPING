/**
 * GET /api/health
 *
 * 설정이 제대로 들어갔는지 확인한다. 값은 절대 내보내지 않고
 * 있는지 없는지만 알려준다.
 */

import { json } from "../_shared.js";

export async function onRequestGet({ env }) {
  const present = (name) => Boolean(env[name] && String(env[name]).trim());

  const config = {
    SUPABASE_URL: present("SUPABASE_URL"),
    SUPABASE_SECRET_KEY: present("SUPABASE_SECRET_KEY"),
    RESEND_API_KEY: present("RESEND_API_KEY"),
    MAIL_FROM: present("MAIL_FROM"),
  };

  let supabaseReachable = null;
  if (config.SUPABASE_URL && config.SUPABASE_SECRET_KEY) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/subscribers?select=id&limit=1`, {
        headers: {
          apikey: env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        },
      });
      supabaseReachable = res.status;
    } catch (err) {
      supabaseReachable = `error: ${err.message}`;
    }
  }

  const ready = config.SUPABASE_URL && config.SUPABASE_SECRET_KEY;
  return json({ ready, config, supabaseReachable }, ready ? 200 : 503);
}
