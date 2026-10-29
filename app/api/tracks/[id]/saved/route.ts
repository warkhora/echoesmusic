import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tracks } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { saved?: boolean };

  try {
    const [row] = await db
      .update(tracks)
      .set({ saved: Boolean(body.saved) })
      .where(eq(tracks.id, id))
      .returning({ id: tracks.id, saved: tracks.saved });

    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, saved: row.saved });
  } catch (error) {
    return Response.json({ ok: false, detail: String(error) }, { status: 500 });
  }
}
