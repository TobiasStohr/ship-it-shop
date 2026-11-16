import { isAdminRequest } from "@/lib/admin-session";
import { reconnectChatTurn } from "@/lib/chat/route-helpers";

export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return reconnectChatTurn(request, (await params).id, "adminChatFlow");
}
