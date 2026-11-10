import type { PnlParams } from '@/modules/reports/pnl'

type ClientOpt = { id: string; name: string }
type ProjectOpt = { id: string; name: string; clientId: string; clientName: string }

const input = 'h-8 rounded-lg border bg-card px-2 text-sm'
const button = 'inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium'

const GROUPS: { value: PnlParams['group']; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'client', label: 'Client' },
  { value: 'project', label: 'Project' },
]

export function PnlFilters({
  firmId,
  from,
  to,
  group,
  clients,
  projects,
  selectedClients,
  selectedProjects,
  exportQuery,
}: {
  firmId: string
  from: string
  to: string
  group: PnlParams['group']
  clients: ClientOpt[]
  projects: ProjectOpt[]
  selectedClients: string[]
  selectedProjects: string[]
  exportQuery: string
}) {
  const byClient = new Map<string, { name: string; items: ProjectOpt[] }>()
  for (const p of projects) {
    const g = byClient.get(p.clientId) ?? { name: p.clientName, items: [] }
    g.items.push(p)
    byClient.set(p.clientId, g)
  }
  const groups = [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <form method="get" aria-label="Report filters" className="mt-4 space-y-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pnl-from">From</label>
          <input id="pnl-from" name="from" type="date" defaultValue={from} className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pnl-to">To</label>
          <input id="pnl-to" name="to" type="date" defaultValue={to} className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pnl-group">Group by</label>
          <select id="pnl-group" name="group" defaultValue={group} className={input}>
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={`${button} bg-primary text-primary-foreground hover:bg-primary-hover`}>
          Show report
        </button>
        <a href={`/f/${firmId}/reports/pnl/csv${exportQuery ? `?${exportQuery}` : ''}`} className={`${button} border`}>
          Export CSV
        </a>
      </div>

      <fieldset className="space-y-1">
        <legend className="font-medium">Clients</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {clients.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5">
              <input type="checkbox" name="client" value={c.id} defaultChecked={selectedClients.includes(c.id)} />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-medium">Projects</legend>
        <p className="text-muted-foreground">Projects narrow the selected clients</p>
        {groups.map((g) => (
          <div key={g.name} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-muted-foreground">{g.name}</span>
            {g.items.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5">
                <input type="checkbox" name="project" value={p.id} defaultChecked={selectedProjects.includes(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
    </form>
  )
}
