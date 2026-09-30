import { fail, ok, storyResource, withActor } from "@/lib/api";
import { attachModel, getStory, storyIdOr400 } from "@/lib/stories";
import { REJECTION_COPY } from "@/lib/models";
import { MAX_REQUEST_BYTES } from "@/lib/upload-limits";

/**
 * The owner puts the printable model on a ticket.
 *
 * How a link or description request becomes something the viewer, the
 * download and the slicer link can work with: the owner fetches the file
 * from the link (or draws what was described) and attaches the bytes here.
 * Replacing the file on a file ticket works the same way.
 *
 * Multipart like `/api/upload`, for the same reason — a large model over
 * office wifi deserves a progress bar — and the bytes go through the same
 * authoritative inspection. Allowed once the request is approved.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withActor<{ id: string }>(
  async (request, actor, { id }) => {
    const storyId = storyIdOr400(id);

    // Cheap rejection before reading a single byte of the body, matching the
    // transport limit so a file just over the cap is answered "too large"
    // rather than truncated into a parse failure.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) {
      return fail(413, REJECTION_COPY.too_large);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "That upload did not arrive intact. Try again.");
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, "No file was attached.");
    }

    const done = await attachModel(actor, storyId, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return ok({
      story: storyResource(await getStory(actor, storyId)),
      attached: { filename: done.filename, dims: done.dims },
      notified: done.uploaderName,
    });
  },
  { admin: true },
);
