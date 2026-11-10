import { requireFirmRole } from "@/lib/auth/context";
import { todayIso } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import {
  getPnl,
  parsePnlParams,
  pnlBreakdownColumns,
  type PnlRow,
} from "@/modules/reports/pnl";
import { listClients } from "@/modules/clients/data";
import { getFirm } from "@/modules/firms/data";
import { listProjects } from "@/modules/projects/data";
import { PnlFilters } from "./filters";

export const dynamic = "force-dynamic";

type Sp = Record<string, string | string[] | undefined>;

const th = "py-2 pr-4 font-medium";
const td = "py-2 pr-4 align-top";

const MONEY_FIELDS = [
  "revenueHours",
  "fees",
  "discounts",
  "revenue",
  "labour",
  "gross",
  "directExpenses",
  "overhead",
  "net",
  "invoiced",
  "collected",
] as const;

function queryString(sp: Sp): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else if (v !== undefined) q.set(k, v);
  }
  return q.toString();
}

function isEmpty(rows: PnlRow[]): boolean {
  return rows.every((r) => MONEY_FIELDS.every((f) => Number(r[f]) === 0));
}

export default async function PnlPage({
  params,
  searchParams,
}: {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<Sp>;
}) {
  const { firmId } = await params;
  const sp = await searchParams;
  const { db } = await requireFirmRole(firmId, ["admin", "manager"]);
  const today = todayIso();
  const parsed = parsePnlParams(sp, today);
  const [clientsRes, projectsRes, firmRes] = await Promise.all([
    listClients(db, firmId, { includeInactive: true }),
    listProjects(db, firmId),
    getFirm(db, firmId),
  ]);
  if (!clientsRes.ok || !projectsRes.ok || !firmRes.ok) {
    const message = !clientsRes.ok
      ? clientsRes.error
      : !projectsRes.ok
        ? projectsRes.error
        : !firmRes.ok
          ? firmRes.error
          : "";
    return (
      <div className="max-w-7xl">
        <h1 className="text-2xl font-semibold">Profit &amp; loss</h1>
        <p role="alert" className="mt-4 text-sm text-destructive">
          {message}
        </p>
      </div>
    );
  }
  const currency = firmRes.data.currency;
  const clients = clientsRes.data.map((c) => ({ id: c.id, name: c.name }));
  const projects = projectsRes.data.map((x) => ({
    id: x.id,
    name: x.name,
    clientId: x.clientId,
    clientName: x.clientName,
  }));

  const p = parsed.ok ? parsed.data : null;
  const result = p ? await getPnl(db, firmId, p) : null;
  const periodic = p ? p.group === "month" || p.group === "quarter" : false;
  const filtered = !!p && (p.clientIds !== null || p.projectIds !== null);
  const cols = p
    ? pnlBreakdownColumns(p)
    : { client: false, project: false };
  const byProject = p?.group === "project";
  const error = !parsed.ok
    ? parsed.error
    : result && !result.ok
      ? result.error
      : null;
  const rows = result && result.ok ? result.data : null;

  const money = (v: string) => (
    <span
      className={
        v.startsWith("-") ? "text-red-700 dark:text-red-400" : undefined
      }
    >
      {formatMoney(v, currency)}
    </span>
  );

  return (
    <div className="max-w-7xl">
      <h1 className="text-2xl font-semibold">Profit &amp; loss</h1>
      <PnlFilters
        firmId={firmId}
        from={
          p?.from ??
          (typeof sp.from === "string" ? sp.from : `${today.slice(0, 4)}-01-01`)
        }
        to={p?.to ?? (typeof sp.to === "string" ? sp.to : today)}
        group={p?.group ?? "month"}
        split={p?.split ?? { client: false, project: false }}
        clients={clients}
        projects={projects}
        selectedClients={p?.clientIds ?? []}
        selectedProjects={p?.projectIds ?? []}
        exportQuery={queryString(sp)}
      />

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {rows && (
        <>
          {isEmpty(rows) && (
            <p className="mt-4 text-sm">No activity in this period.</p>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Profit and loss by {p?.group}, {p?.from} to {p?.to}
              </caption>
              <thead>
                <tr className="border-b">
                  {[
                    "Group",
                    ...(cols.client ? ["Client"] : []),
                    ...(cols.project ? ["Project"] : []),
                    "Revenue",
                    "Labour cost",
                    "Gross profit",
                    "Direct expenses",
                    "Overhead",
                    "Net profit",
                    "Margin",
                    "Invoiced",
                    "Collected",
                  ].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const label =
                    r.kind === "overhead"
                      ? "Unallocated overhead"
                      : r.kind === "total"
                        ? "Total"
                        : r.label;
                  // Project grouping shows the client and project in their own
                  // columns; the combined label stays as the row header's name.
                  const shownLabel =
                    byProject && r.kind === "group" ? "" : label;
                  const bold = r.kind === "total" || r.kind === "subtotal";
                  // Client and project rows have no overhead of their own.
                  const noOverhead =
                    !periodic &&
                    (r.kind === "group" ||
                      r.kind === "detail" ||
                      r.kind === "subtotal");
                  const tip = `Hours ${formatMoney(r.revenueHours, currency)} + fees ${formatMoney(r.fees, currency)} − discounts ${formatMoney(r.discounts, currency)}`;
                  return (
                    <tr
                      key={`${r.kind}:${r.key}`}
                      className={`border-b ${bold ? "font-bold" : ""} ${r.kind === "subtotal" ? "bg-selected" : ""}`}
                    >
                      <th
                        scope="row"
                        aria-label={shownLabel === label ? undefined : label}
                        className={`${td} text-left ${bold ? "font-bold" : "font-normal"}`}
                      >
                        {shownLabel}
                      </th>
                      {cols.client && (
                        <td className={td}>{r.clientLabel ?? ""}</td>
                      )}
                      {cols.project && (
                        <td className={td}>{r.projectLabel ?? ""}</td>
                      )}
                      <td className={td} title={tip}>
                        {money(r.revenue)}
                      </td>
                      <td className={td}>{money(r.labour)}</td>
                      <td className={td}>{money(r.gross)}</td>
                      <td className={td}>
                        {r.kind === "overhead" ? "—" : money(r.directExpenses)}
                      </td>
                      <td className={td}>
                        {noOverhead ? "—" : money(r.overhead)}
                      </td>
                      <td className={td}>{money(r.net)}</td>
                      <td className={td}>
                        {r.margin === null ? "—" : `${r.margin}%`}
                      </td>
                      <td className={td}>{money(r.invoiced)}</td>
                      <td className={td}>{money(r.collected)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered && (
            <p className="mt-4 text-sm text-muted-foreground">
              Overhead is excluded while a client or project filter is applied.
            </p>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            Revenue and labour are counted when the work was done (approved
            hours only); fees and discounts when invoiced. Invoiced and
            Collected exclude tax.
          </p>
        </>
      )}
    </div>
  );
}
