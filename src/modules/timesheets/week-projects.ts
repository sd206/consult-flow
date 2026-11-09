import type { WeekProject } from './data'

/** One row of the `week_projects` rpc, in camelCase. */
export type WeekProjectRow = {
  assignmentId: string
  projectId: string
  projectName: string
  projectCode: string | null
  clientName: string
  effectiveFrom: string
  effectiveTo: string | null
}

/** Collapse assignment rows into one entry per project; activeDays are the week days covered by any row. */
export function groupWeekProjects(rows: WeekProjectRow[], days: string[]): WeekProject[] {
  const byProject = new Map<string, WeekProject>()
  for (const r of rows) {
    let p = byProject.get(r.projectId)
    if (!p) {
      p = {
        projectId: r.projectId,
        projectName: r.projectName,
        projectCode: r.projectCode,
        clientName: r.clientName,
        activeDays: [],
      }
      byProject.set(r.projectId, p)
    }
  }
  return [...byProject.values()].map((p) => ({
    ...p,
    activeDays: days.filter((d) =>
      rows.some(
        (r) => r.projectId === p.projectId && d >= r.effectiveFrom && (r.effectiveTo === null || d <= r.effectiveTo),
      ),
    ),
  }))
}
