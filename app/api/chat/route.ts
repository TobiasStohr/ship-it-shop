import { startChatTurn } from "@/lib/chat/route-helpers";
import { shoppingTools } from "@/lib/tools";
import { chatFlow } from "@/lib/workflows/chat-flow";

export const maxDuration = 60;

export async function POST(request: Request) {
  return startChatTurn(request, chatFlow, shoppingTools);
}
