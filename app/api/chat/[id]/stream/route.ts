import { reconnectChatTurn } from "@/lib/chat/route-helpers";

export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return reconnectChatTurn(request, (await params).id, "chatFlow");
}
