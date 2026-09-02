import { cors, admin, user, ok, fail, requestId } from "../_shared/core.ts";

Deno.serve(async (req: Request) => {
  const rid = requestId();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "PATCH") return fail("method_not_allowed", "PATCH required", rid, 405);
  try {
    const caller = await user(req);
    const body = await req.json();
    const matchId = body.id;
    const target = body.status;
    if (!matchId || !["viewed", "applied"].includes(target)) {
      return fail("invalid_request", "id and status=viewed|applied are required", rid, 422);
    }
    const db = admin();
    const { data: current } = await db.from("job_matches").select("id,status,viewed_at,applied_at").eq("id", matchId).eq("user_id", caller.id).maybeSingle();
    if (!current) return fail("not_found", "Match not found", rid, 404);
    if (current.status === "expired") return fail("invalid_status_transition", "Expired matches cannot be changed", rid, 422);
    if (current.status === target) return ok({ match: current }, rid);
    const now = new Date().toISOString();
    const updates = target === "applied"
      ? { status: "applied", viewed_at: current.viewed_at ?? now, applied_at: now }
      : { status: "viewed", viewed_at: current.viewed_at ?? now, applied_at: null };
    const { data, error } = await db.from("job_matches").update(updates).eq("id", current.id).eq("user_id", caller.id).select("id,status,viewed_at,applied_at").single();
    if (error) throw error;
    return ok({ match: data }, rid);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail(message === "unauthenticated" ? "unauthenticated" : "internal_error", message, rid, message === "unauthenticated" ? 401 : 500);
  }
});
