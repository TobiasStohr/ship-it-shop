import { adminTools } from "@/lib/admin-tools";
import { isAdminRequest } from "@/lib/admin-session";
import { startChatTurn } from "@/lib/chat/route-helpers";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return startChatTurn(request, adminChatFlow, adminTools);
}
