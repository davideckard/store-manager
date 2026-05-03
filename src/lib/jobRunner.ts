import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { prisma } from './prisma'

const WORKER_SCRIPT = path.join(process.cwd(), 'worker', 'upload.py')
const JOBS_DIR = process.env.JOBS_DIR ?? '/data/jobs'

// In-memory map of jobId → child process
const runningProcs = new Map<string, ReturnType<typeof spawn>>()

export function jobDir(jobId: string) {
  return path.join(JOBS_DIR, jobId)
}

export function logPath(jobId: string) {
  return path.join(jobDir(jobId), 'upload.log')
}

export function reportPath(jobId: string): string | null {
  const dir = jobDir(jobId)
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'))
  return files.length > 0 ? path.join(dir, files[0]) : null
}

export function reportHasIssues(jobId: string): boolean {
  const rp = reportPath(jobId)
  if (!rp) return false
  try {
    return fs.readFileSync(rp, 'utf8').includes('INCOMPLETE PRODUCTS')
  } catch {
    return false
  }
}

function buildArgs(params: Record<string, unknown>): { args: string[]; env: Record<string, string> } {
  const args: string[] = [params.siteId as string]
  const mode = params.mode as string

  if (params.storeId) args.push('--store-id', params.storeId as string)
  if (params.orderboardUrl) args.push('--orderboard-url', params.orderboardUrl as string)

  if (mode === 'audit') args.push('--audit', '--audit-file', 'report.txt')
  else if (mode === 'fix') args.push('--fix', '--fix-file', 'report.txt')

  if (params.force && mode === 'upload') args.push('--force')
  if (params.squarePad && mode === 'upload') args.push('--square-pad')
  if (params.randomizeImage && mode === 'upload') args.push('--randomize-image')
  if (params.setCategoryImages && mode === 'upload') args.push('--set-category-images')

  if (params.filterSkus && (params.filterSkus as string[]).length > 0)
    args.push('--filter-skus', (params.filterSkus as string[]).join(','))

  if (params.fromAuditJob) {
    const rp = reportPath(params.fromAuditJob as string)
    if (rp) args.push('--from-audit', rp)
  }

  const env: Record<string, string> = {}
  if (params.email) env['ORDERBOARD_EMAIL'] = params.email as string
  if (params.password) env['ORDERBOARD_PASSWORD'] = params.password as string

  return { args, env }
}

export async function runJob(jobId: string, params: Record<string, unknown>) {
  const dir = jobDir(jobId)
  fs.mkdirSync(dir, { recursive: true })

  const { args, env } = buildArgs(params)
  const storeManagerUrl = process.env.STORE_MANAGER_URL ?? 'http://localhost:3000'

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date() },
  })

  const logFd = fs.openSync(logPath(jobId), 'w')
  const proc = spawn('python3', [WORKER_SCRIPT, ...args], {
    cwd: dir,
    env: { ...process.env, STORE_MANAGER_URL: storeManagerUrl, ...env },
    stdio: ['ignore', logFd, logFd],
  })

  runningProcs.set(jobId, proc)

  proc.on('close', async (code) => {
    fs.closeSync(logFd)
    runningProcs.delete(jobId)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: code === 0 ? 'complete' : 'failed',
        finishedAt: new Date(),
        exitCode: code ?? -1,
      },
    })
  })
}

export function killJob(jobId: string) {
  const proc = runningProcs.get(jobId)
  if (proc) {
    proc.kill()
    runningProcs.delete(jobId)
  }
}

export function isRunning(jobId: string) {
  return runningProcs.has(jobId)
}

export async function markAbandonedJobs() {
  await prisma.job.updateMany({
    where: { status: { in: ['running', 'pending'] } },
    data: { status: 'failed', exitCode: -1 },
  })
}
