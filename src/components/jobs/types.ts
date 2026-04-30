export interface Job {
  id: string
  siteId: string
  mode: 'upload' | 'audit' | 'fix'
  params: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  hasReport: boolean
  hasIssues: boolean
}

export interface Site {
  id: number
  slug: string
  name: string
}

export interface Store {
  id: string
  name: string
}
