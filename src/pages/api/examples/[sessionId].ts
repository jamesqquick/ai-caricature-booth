import { env } from "cloudflare:workers";
import { loadSession } from "../../../db/sessions";
import { hasOwnedPostcard, isOwnedSessionAssetKey } from "../../../lib/selfie-ownership";
import { isFeaturedSessionId } from "../../../data/featured-postcards";

export const prerender = false;

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET({ params }: { params: Record<string, string | undefined> }) {
  const sessionId = params.sessionId;
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId) || !isFeaturedSessionId(sessionId)) return notFound();

  try {
    const session = await loadSession(env.FEATURED_DB, sessionId);
    if (
      !session
      || session.status !== "completed"
      || !session.postcard_key
      || !isOwnedSessionAssetKey(sessionId, "postcard", session.postcard_key)
    ) return notFound();

    const object = await env.FEATURED_SELFIES.get(session.postcard_key);
    if (!object || !hasOwnedPostcard(object, session.postcard_key, {
      sessionId,
      eventId: session.event_id,
      workflowInstanceId: session.workflow_instance_id,
    })) return notFound();

    return new Response(object.body, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "image/jpeg",
        "Content-Disposition": 'inline; filename="featured-caricature-postcard.jpg"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
