#!/usr/bin/env node
/* Server-only first-login bootstrap. Never put this file or its key in the client. */
import fs from 'node:fs/promises';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const mapPath = process.argv[2];
if (!mapPath) throw new Error('Usage: node bootstrap-users.mjs <email-map.json>');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
const mapping = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const entries = Object.entries(mapping);
if (entries.length !== 7 || entries.some(([id, email]) => !/^user_[a-z0-9]+$/.test(id) || !/^\S+@\S+\.\S+$/.test(email))) {
  throw new Error('The map must contain exactly seven legacy IDs and valid email addresses');
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUser(email) {
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}
for (const [legacyId, email] of entries.sort(([a], [b]) => a.localeCompare(b))) {
  const { data: profile, error: readError } = await admin.from('profiles').select('auth_user_id').eq('id', legacyId).maybeSingle();
  if (readError) throw readError;
  let authId = profile?.auth_user_id;
  if (!authId) {
    let user = await findUser(email);
    if (!user) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, process.env.SUPABASE_REDIRECT_URL ? { options: { redirectTo: process.env.SUPABASE_REDIRECT_URL } } : undefined);
      if (error) throw error;
      user = data.user;
    }
    authId = user.id;
    const { error } = await admin.from('profiles').update({ auth_user_id: authId }).eq('id', legacyId).is('auth_user_id', null);
    if (error) throw error;
  }
  // Deliberately report only the legacy ID and outcome, never email, key, or credentials.
  console.log(`${legacyId}: linked`);
}
