'use client'

import { useState } from 'react'
import type { PnlParams } from '@/modules/reports/pnl'
import { MultiSelect, type MultiSelectGroup } from './multi-select'

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
  split,
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
  split: PnlParams['split']
  clients: ClientOpt[]
  projects: ProjectOpt[]
  selectedClients: string[]
  selectedProjects: string[]
  exportQuery: string
}) {
  // The group is tracked so the "Add columns" choices follow it before submitting.
  const [groupBy, setGroupBy] = useState(group)
  const [splitClient, setSplitClient] = useState(split.client)
  const [splitProject, setSplitProject] = useState(split.project)
  const periodic = groupBy === 'month' || groupBy === 'quarter'

  const byClient = new Map<string, { name: string; items: ProjectOpt[] }>()
  for (const p of projects) {
    const g = byClient.get(p.clientId) ?? { name: p.clientName, items: [] }
    g.items.push(p)
    byClient.set(p.clientId, g)
  }
  const projectGroups: MultiSelectGroup[] = [...byClient.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ heading: g.name, options: g.items.map((p) => ({ id: p.id, name: p.name })) }))

  return (
    <form method="get" aria-label="Report filters" className="mt-4 space-y-3 text-sm">
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
          <select
            id="pnl-group"
            name="group"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as PnlParams['group'])}
            className={input}
          >
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <MultiSelect
          label="Clients"
          name="client"
          groups={[{ heading: null, options: clients }]}
          selected={selectedClients}
          noun={{ all: 'All clients', plural: 'clients' }}
        />
        <MultiSelect
          label="Projects"
          name="project"
          groups={projectGroups}
          selected={selectedProjects}
          noun={{ all: 'All projects', plural: 'projects' }}
          hint="Projects narrow the selected clients"
        />
        <button type="submit" className={`${button} bg-primary text-primary-foreground hover:bg-primary-hover`}>
          Show report
        </button>
        <a href={`/f/${firmId}/reports/pnl/csv${exportQuery ? `?${exportQuery}` : ''}`} className={`${button} border`}>
          Export CSV
        </a>
      </div>

      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <legend className="float-left mr-4 font-medium">Add columns:</legend>
        {groupBy === 'project' ? (
          <span className="text-muted-foreground">Project grouping always shows Client and Project columns.</span>
        ) : (
          <>
            {/* Client grouping already has one row per client, so only Project applies. */}
            {periodic && (
              <label className="flex items-center gap-1.5">
                {/* A project split implies the client column: projects belong to clients. */}
                <input
                  type="checkbox"
                  name="split"
                  value="client"
                  checked={splitClient || splitProject}
                  disabled={splitProject}
                  onChange={(e) => setSplitClient(e.target.checked)}
                />
                Client
              </label>
            )}
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="split"
                value="project"
                checked={splitProject}
                onChange={(e) => setSplitProject(e.target.checked)}
              />
              Project
            </label>
          </>
        )}
      </fieldset>
    </form>
  )
}
