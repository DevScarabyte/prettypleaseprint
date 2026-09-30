import { jsonBody, ok, storyResource, withActor } from "@/lib/api";
import { getStory, renameStory, storyIdOr400, withdrawStory } from "@/lib/stories";

/**
 * One ticket, renaming it, and taking it back.
 *
 * `GET` is scoped: a client naming somebody else's id is answered 404, not
 * 403, because a 403 would confirm the ticket exists. That is the same
 * decision the story page makes, through the same `storyScope` fragment.
 *
 * `PATCH` renames it. The person who asked for it, or the printer owner —
 * anybody else gets the same 404 as `GET`, for the same reason. Audited,
 * but deliberately not notified: a new name is worth finding in the trail,
 * not worth pinging the other side over.
 *
 * `DELETE` is the requester withdrawing their own request, and is refused
 * once the printer owner has started on it. The printer owner cannot delete
 * somebody's ticket through it either — being able to see every story is not
 * being allowed to withdraw one. Both rules are `withdrawStory`'s, so the
 * form and this endpoint cannot disagree.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withActor<{ id: string }>(async (_request, actor, { id }) => {
  const story = await getStory(actor, storyIdOr400(id));
  return ok(storyResource(story));
});

export const DELETE = withActor<{ id: string }>(async (_request, actor, { id }) => {
  const done = await withdrawStory(actor, storyIdOr400(id));
  return ok({ withdrawn: true, id: done.id, ref: done.ref, wasStatus: done.wasStatus });
});

export const PATCH = withActor<{ id: string }>(async (request, actor, { id }) => {
  const storyId = storyIdOr400(id);
  const body = await jsonBody(request);
  const done = await renameStory(actor, storyId, body.title);
  return ok({
    story: storyResource(await getStory(actor, storyId)),
    renamed: { to: done.title, unchanged: done.unchanged },
  });
});
