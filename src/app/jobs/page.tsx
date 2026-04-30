'use client'

import { useCallback, useEffect, useState } from 'react'
import { Job } from '@/components/jobs/types'
import { JobForm } from '@/components/jobs/JobForm'
import { JobsTable } from '@/components/jobs/JobsTable'
import { JobDetail } from '@/components/jobs/JobDetail'

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/jobs')
    if (res.ok) {
      setJobs(await res.json())
      setLastUpdated(new Date().toLocaleTimeString())
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load])

  const selectedJob = jobs.find(j => j.id === selectedId) ?? null

  const auditJobs = jobs.filter(j =>
    (j.mode === 'audit' || j.mode === 'fix') && j.status === 'complete' && j.hasReport
  )

  function handleSubmitted(id: string) {
    load().then(() => setSelectedId(id))
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-5 items-start">
      <div className="space-y-4">
        <JobForm onSubmitted={handleSubmitted} auditJobs={auditJobs} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">Jobs</h1>
          {lastUpdated && <span className="text-xs text-slate-400">Updated {lastUpdated}</span>}
        </div>
        <JobsTable jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} onRefresh={load} />
        {selectedJob && (
          <JobDetail job={selectedJob} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  )
}
