import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigin = Deno.env.get("APP_URL") ?? "*";

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin === "*" || origin === allowedOrigin ? (origin || "*") : allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function response(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0]}` : name.slice(0, 2)).toUpperCase();
}

function legacyIdFor(name: string) {
  const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 12);
  return `user_${slug}_${crypto.randomUUID().slice(0, 6)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return response(req, { error: "Method not allowed" }, 405);
  if (!supabaseUrl || !secretKey) return response(req, { error: "Function is not configured" }, 500);

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!bearer) return response(req, { error: "Authentication required" }, 401);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !authData.user) return response(req, { error: "Invalid session" }, 401);

  const { data: actor } = await admin.from("profiles").select("id").eq("auth_user_id", authData.user.id).maybeSingle();
  const { data: actorRole } = actor
    ? await admin.from("profile_roles").select("is_admin").eq("user_id", actor.id).maybeSingle()
    : { data: null };
  if (!actor || !actorRole?.is_admin) return response(req, { error: "Administrator access required" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response(req, { error: "Invalid JSON body" }, 400); }
  const action = String(body.action ?? "");

  try {
    if (action === "list") {
      const [{ data: profiles, error }, usersResult] = await Promise.all([
        admin.from("profiles").select("id,name,initials,profile_picture,auth_user_id,profile_roles(is_admin,is_approver),permissions(*)").order("name"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      ]);
      if (error) throw error;
      const emailById = new Map(usersResult.data.users.map((u) => [u.id, u.email]));
      return response(req, (profiles ?? []).map((p: any) => ({
        ...p,
        email: p.auth_user_id ? emailById.get(p.auth_user_id) ?? null : null,
        is_admin: !!p.profile_roles?.is_admin,
        is_approver: !!p.profile_roles?.is_approver,
      })));
    }

    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim();
      let profileId = String(body.profileId ?? "").trim();
      if (!email || !email.includes("@")) return response(req, { error: "A valid email is required" }, 400);

      if (!profileId) {
        if (!name) return response(req, { error: "Name is required for a new profile" }, 400);
        profileId = legacyIdFor(name);
        const { error } = await admin.from("profiles").insert({ id: profileId, name, initials: initialsFor(name) });
        if (error) throw error;
        await admin.from("profile_roles").insert({ user_id: profileId, is_admin: false, is_approver: false });
      }

      const { data: profile, error: profileError } = await admin.from("profiles").select("id,name,auth_user_id").eq("id", profileId).single();
      if (profileError) throw profileError;
      if (profile.auth_user_id) return response(req, { error: "Profile already has a login" }, 409);

      const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo : undefined;
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { name: profile.name, legacy_id: profile.id },
      });
      if (error) throw error;
      const { error: linkError } = await admin.from("profiles").update({ auth_user_id: data.user.id }).eq("id", profile.id);
      if (linkError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw linkError;
      }
      return response(req, { success: true, profileId: profile.id, email });
    }

    if (action === "update") {
      const profileId = String(body.profileId ?? "");
      if (!profileId) return response(req, { error: "profileId is required" }, 400);
      const changes: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim()) {
        changes.name = body.name.trim();
        changes.initials = initialsFor(body.name);
      }
      if (Object.keys(changes).length) {
        const { error } = await admin.from("profiles").update(changes).eq("id", profileId);
        if (error) throw error;
      }
      if (typeof body.isAdmin === "boolean" || typeof body.isApprover === "boolean") {
        if (profileId === actor.id && body.isAdmin === false) return response(req, { error: "Cannot remove your own admin role" }, 400);
        const { data: existing } = await admin.from("profile_roles").select("is_admin,is_approver").eq("user_id", profileId).maybeSingle();
        const { error } = await admin.from("profile_roles").upsert({
          user_id: profileId,
          is_admin: typeof body.isAdmin === "boolean" ? body.isAdmin : !!existing?.is_admin,
          is_approver: typeof body.isApprover === "boolean" ? body.isApprover : !!existing?.is_approver,
        });
        if (error) throw error;
      }
      return response(req, { success: true });
    }

    if (action === "set-password") {
      const profileId = String(body.profileId ?? "");
      const password = String(body.password ?? "");
      if (password.length < 8) return response(req, { error: "Password must have at least 8 characters" }, 400);
      const { data: profile, error } = await admin.from("profiles").select("auth_user_id").eq("id", profileId).single();
      if (error || !profile.auth_user_id) return response(req, { error: "Profile has no login" }, 404);
      const update = await admin.auth.admin.updateUserById(profile.auth_user_id, { password });
      if (update.error) throw update.error;
      return response(req, { success: true });
    }

    if (action === "delete") {
      const profileId = String(body.profileId ?? "");
      const { data: role } = await admin.from("profile_roles").select("is_admin").eq("user_id", profileId).maybeSingle();
      if (role?.is_admin) return response(req, { error: "Remove the admin role before deleting this user" }, 409);
      const { count } = await admin.from("budget_entries").select("id", { count: "exact", head: true }).eq("user_id", profileId);
      if ((count ?? 0) > 0) return response(req, { error: `User has ${count} budget entries` }, 409);
      const { data: profile } = await admin.from("profiles").select("auth_user_id").eq("id", profileId).maybeSingle();
      if (profile?.auth_user_id) {
        const deleted = await admin.auth.admin.deleteUser(profile.auth_user_id);
        if (deleted.error) throw deleted.error;
      }
      const { error } = await admin.from("profiles").delete().eq("id", profileId);
      if (error) throw error;
      return response(req, { success: true });
    }

    return response(req, { error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return response(req, { error: message }, 500);
  }
});

