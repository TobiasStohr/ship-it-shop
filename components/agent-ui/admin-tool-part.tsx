"use client";

import { BookmarkPlus, CircleAlert, Database, SearchX, SquareTerminal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ShoppingToolPartView } from "@/components/agent-ui/shopping-tool-part";
import { isInvalidInputError, Loading, Notice } from "@/components/agent-ui/tool-states";
import type { AdminAgentUIMessage } from "@/lib/admin-agent";

type AdminToolPart = Extract<AdminAgentUIMessage["parts"][number], { type: `tool-${string}` }>;

const VISIBLE_ROWS = 8;

const LOADING_LABELS = new Map<AdminToolPart["type"], string>([
  ["tool-getSupportTickets", "Reading support tickets"],
  ["tool-getReturnsHistory", "Reading returns"],
  ["tool-getInventoryStock", "Reading stock"],
  ["tool-getSalesAnalytics", "Reading sales"],
  ["tool-loadStoreData", "Copying store data into the sandbox"],
  ["tool-saveMemory", "Saving to memory"],
]);

const SANDBOX_TOOLS = new Set<AdminToolPart["type"]>(["tool-loadStoreData", "tool-saveMemory"]);

/** Renders one admin tool call for each of its states. */
export function AdminToolPartView({ part }: { part: AdminToolPart }) {
  if (isInvalidInputError(part)) return null;

  if (part.type === "tool-searchProducts" || part.type === "tool-getAllCategories") {
    return <ShoppingToolPartView part={part} />;
  }

  // The bash card shows the command in every state, so it handles its own states.
  if (part.type === "tool-bash") {
    return <BashCard part={part} />;
  }

  // errorText holds internal step names, so the card shows a fixed message.
  if (part.state === "output-error") {
    return (
      <Notice tone="error" icon={<CircleAlert aria-hidden className="size-4" />}>
        {SANDBOX_TOOLS.has(part.type)
          ? "The sandbox is not available right now. Try again in a moment."
          : "This data could not be loaded. The store may be busy, so try again in a moment."}
      </Notice>
    );
  }
  if (part.state !== "output-available") {
    return <Loading label={LOADING_LABELS.get(part.type) ?? "Reading data"} rows={1} />;
  }

  switch (part.type) {
    case "tool-getInventoryStock": {
      const { rows, lowStockOnPage, outOfStockOnPage, pagination } = part.output;
      const counts = `${lowStockOnPage} low · ${outOfStockOnPage} sold out`;
      return (
        <DataCard
          title="Inventory"
          summary={
            pagination.totalPages > 1
              ? `${pagination.total} products · page ${pagination.page} of ${pagination.totalPages} · ${counts} on this page`
              : `${pagination.total} products · ${counts}`
          }
          columns={["Product", "Stock", "State"]}
          rows={rows.map((row) => [
            row.name,
            String(row.stock),
            !row.inStock ? "Sold out" : row.lowStock ? "Low" : "In stock",
          ])}
        />
      );
    }

    case "tool-getSalesAnalytics": {
      const output = part.output;
      if (output.status === "not_found") {
        return (
          <Notice icon={<SearchX aria-hidden className="size-4" />}>
            No product matches “{output.productId}”.
          </Notice>
        );
      }
      return (
        <DataCard
          title="Sales"
          summary={`${formatRange(output.range)} · ${output.totals.unitsSold} units · ${output.totals.ordersCount} orders · ${output.totals.revenueFormatted}`}
          columns={["Product", "Units", "Orders", "Revenue"]}
          rows={output.rows.map((row) => [
            row.name,
            String(row.unitsSold),
            String(row.ordersCount),
            row.revenueFormatted,
          ])}
          footer={
            output.productCount > output.rows.length
              ? `Top ${output.rows.length} of ${output.productCount} products`
              : undefined
          }
        />
      );
    }

    case "tool-getReturnsHistory": {
      const output = part.output;
      return (
        <DataCard
          title="Returns"
          summary={joinParts(formatRange(output.range), `${output.total} returns`, formatCounts(output.byDecision), `refunded ${output.refundedFormatted}`)}
          columns={["Most returned", "Units"]}
          rows={output.topReturnedProducts.map((row) => [row.name, String(row.units)])}
        />
      );
    }

    case "tool-getSupportTickets": {
      const output = part.output;
      return (
        <DataCard
          title="Support tickets"
          summary={joinParts(formatRange(output.range), `${output.total} tickets`, formatCounts(output.byStatus))}
          columns={["Subject", "Priority", "Status"]}
          rows={output.tickets.map((ticket) => [
            ticket.subject,
            ticket.priority,
            ticket.status,
          ])}
          footer={
            output.total > output.tickets.length
              ? `Newest ${output.tickets.length} of ${output.total} tickets`
              : undefined
          }
        />
      );
    }

    case "tool-loadStoreData": {
      const output = part.output;
      return (
        <DataCard
          title="Store data in the sandbox"
          icon={<Database aria-hidden className="size-4" />}
          summary={joinParts(`${output.range.from} – ${output.range.to}`, `fetched ${formatTime(output.fetchedAt)}`)}
          columns={["File", "Rows"]}
          rows={output.files.map((file) => [file.path, file.truncated ? `${file.rows} (limit reached)` : String(file.rows)])}
        />
      );
    }

    case "tool-saveMemory":
      return (
        <Notice icon={<BookmarkPlus aria-hidden className="size-4" />}>
          Saved to memory: “{part.output.saved}”
        </Notice>
      );

    default:
      return null;
  }
}

type BashPart = Extract<AdminToolPart, { type: "tool-bash" }>;

/** Shows the command, then running, output or failure. */
function BashCard({ part }: { part: BashPart }) {
  const command = part.input?.command ?? "";
  let status: ReactNode;
  let body: ReactNode = null;

  if (part.state === "output-error") {
    status = <span className="text-destructive">Failed</span>;
    body = <p className="text-muted-foreground">The sandbox did not run this command. Try again in a moment.</p>;
  } else if (part.state !== "output-available") {
    status = <Shimmer className="text-xs">Running…</Shimmer>;
  } else {
    const ok = part.output.exitCode === 0;
    status = (
      <span className={ok ? "text-muted-foreground" : "text-destructive"}>
        {ok ? "Done" : `Exit ${part.output.exitCode}`} · {(part.output.durationMs / 1000).toFixed(1)} s
      </span>
    );
    body = <BashResult {...part.output} />;
  }

  return (
    <section
      aria-label="Sandbox command"
      aria-busy={part.state !== "output-available" && part.state !== "output-error"}
      className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <SquareTerminal aria-hidden className="size-4 shrink-0" />
        <h3 className="font-medium">Sandbox</h3>
        <span className="ml-auto text-xs" role="status">
          {status}
        </span>
      </header>
      {command && <Output label="Command" text={command} collapsed />}
      {body}
    </section>
  );
}

function BashResult({ exitCode, stdout, stderr, truncated }: BashPart["output"] & {}) {
  return (
    <>
      {stdout && <Output label="Output" text={stdout} />}
      {stderr && <Output label={exitCode === 0 ? "Messages" : "Error"} text={stderr} />}
      {!stdout && !stderr && <p className="text-muted-foreground">No output.</p>}
      {truncated && <p className="text-xs text-muted-foreground">Output was cut to the last part.</p>}
    </>
  );
}

/** A scrollable code block. Long blocks start collapsed. */
function Output({ label, text, collapsed = false }: { label: string; text: string; collapsed?: boolean }) {
  const long = text.split("\n").length > 12;
  const [open, setOpen] = useState(!(collapsed && long));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <pre
        className={`overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed ${open ? "max-h-72 overflow-y-auto" : "max-h-24 overflow-hidden"}`}
      >
        {text}
      </pre>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="self-start text-xs text-muted-foreground underline underline-offset-4"
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

/** A titled table. Rows past the first eight show on request. */
function DataCard({
  title,
  icon,
  summary,
  columns,
  rows,
  footer,
}: {
  title: string;
  icon?: ReactNode;
  summary: string;
  columns: string[];
  rows: string[][];
  footer?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <header>
        <h3 className="flex items-center gap-2 font-medium">
          {icon}
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No rows for this filter.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {columns.map((column, i) => (
                <th key={column} scope="col" className={cellClass(i, "pb-1 font-normal")}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, r) => (
              <tr key={r} className="border-t border-border">
                {row.map((cell, i) => (
                  <td key={i} className={cellClass(i, "py-1.5")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > VISIBLE_ROWS && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="self-start text-xs text-muted-foreground underline underline-offset-4"
        >
          {expanded ? "Show fewer" : `Show ${rows.length - VISIBLE_ROWS} more`}
        </button>
      )}
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

// The first column wraps. The other columns hold short values and stay on one line.
function cellClass(index: number, extra: string): string {
  return index === 0
    ? `${extra} break-words pr-2`
    : `${extra} whitespace-nowrap pl-2 text-right tabular-nums`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatRange({ from, to }: { from: string; to: string }): string {
  return `${formatDay(from)} – ${formatDay(to)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .toSorted((a, b) => b[1] - a[1])
    .map(([key, count]) => `${count} ${key.replaceAll("_", " ")}`)
    .join(" · ");
}
