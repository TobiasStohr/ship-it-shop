import { createWebhook, FatalError, getStepMetadata, sleep } from "workflow";
import {
  createReturn,
  getOrder,
  getReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "@/lib/api";
import { guard } from "@/lib/tool-guard";
import type { Return } from "@/lib/types";

export type ReturnRequest = {
  orderId: string;
  reason: string;
  items: { productId: string; quantity: number }[];
};

export type ReturnFlowResult = {
  orderId: string;
  returnId: string;
  preauthorizationId: string;
  decision: NonNullable<Return["decision"]> | "pending";
  refundAmount: number | null;
};

const CALLBACK_TIMEOUT = "90s";
const POLL_INTERVAL = "30s";
const MAX_POLLS = 10;

/**
 * Processes one return in the background. Each side effect is its own step,
 * so a retry repeats only the failed step. API writes send their `stepId` as
 * the idempotency key.
 */
export async function returnFlow(request: ReturnRequest): Promise<ReturnFlowResult> {
  "use workflow";

  // A failed step ends the run. The customer was told to expect an email,
  // so the catch sends one before the run fails.
  try {
    const order = await lookupOrder(request.orderId);
    await notifyCustomer(order.id);
    const preauthorization = await preauthorizeRefundStep(order.id);

    // The callback only wakes the run. The decision is read from the API,
    // because anyone with the webhook URL can call it. getConflict() registers
    // the webhook before the API sees its URL.
    using webhook = createWebhook();
    await webhook.getConflict();
    const filed = await fileReturn(request, webhook.url);

    await Promise.race([webhook, sleep(CALLBACK_TIMEOUT)]);
    let current = await fetchReturn(filed.id);
    for (let polls = 0; !isDecided(current) && polls < MAX_POLLS; polls++) {
      await sleep(POLL_INTERVAL);
      current = await fetchReturn(filed.id);
    }

    const decision = current.decision ?? "pending";
    await notifyDecision(order.id, decision);

    return {
      orderId: order.id,
      returnId: filed.id,
      preauthorizationId: preauthorization.id,
      decision,
      refundAmount: current.refundAmount,
    };
  } catch (err) {
    await notifyFailure(request.orderId);
    throw err;
  }
}

async function lookupOrder(orderId: string) {
  "use step";
  return guard(async () => {
    const order = await getOrder(orderId);
    if (order.status !== "fulfilled") {
      throw new FatalError(`Order ${orderId} is ${order.status} and cannot be returned.`);
    }
    return { id: order.id };
  });
}

// The notify steps read the email themselves, so it stays out of the event
// log. The starter email helper only logs. A real provider would take the
// stepId as its idempotency key, like the write steps below.
async function notifyCustomer(orderId: string) {
  "use step";
  return guard(async () => {
    const email = await customerEmail(orderId);
    await notifyReturnInProcess(orderId);
    console.log(`[returnFlow] notified ${maskEmail(email)}`);
  });
}

async function preauthorizeRefundStep(orderId: string) {
  "use step";
  const { stepId, attempt } = getStepMetadata();
  return guard(async () => {
    const result = await preauthorizeRefund(orderId, `preauth:${stepId}`);
    console.log(`[returnFlow] preauthorized ${result.id} on attempt ${attempt}`);
    return { id: result.id, amount: result.amount };
  });
}

async function fileReturn(request: ReturnRequest, callback: string) {
  "use step";
  const { stepId } = getStepMetadata();
  return guard(async () => {
    const created = await createReturn({ ...request, callback }, `return:${stepId}`);
    console.log(`[returnFlow] filed return ${created.id} for order ${request.orderId}`);
    return { id: created.id };
  });
}

async function fetchReturn(returnId: string): Promise<Return> {
  "use step";
  return guard(async () => {
    return await getReturn(returnId);
  });
}

async function notifyDecision(orderId: string, decision: string) {
  "use step";
  return guard(async () => {
    const email = await customerEmail(orderId);
    console.log(`[returnFlow] told ${maskEmail(email)} that the return for order ${orderId} is ${decision}`);
  });
}

async function notifyFailure(orderId: string) {
  "use step";
  return guard(async () => {
    const email = await customerEmail(orderId);
    console.log(`[returnFlow] told ${maskEmail(email)} that the return for order ${orderId} failed`);
  });
}

async function customerEmail(orderId: string): Promise<string> {
  return (await getOrder(orderId)).email;
}

function isDecided(value: Return): boolean {
  return value.status === "completed" && value.decision !== null;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}***@${domain ?? ""}`;
}
