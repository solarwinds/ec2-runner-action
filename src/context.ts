import * as core from "@actions/core"
import { context as github, getOctokit } from "@actions/github"
import { EC2Client } from "@aws-sdk/client-ec2"
import { z } from "zod"

interface Loggers {
  debug: typeof core.debug
  info: typeof core.info
  warning: typeof core.warning
  error: typeof core.error
}

export interface CoreContext extends Loggers {
  github: typeof github
  githubToken: string
  octokit: ReturnType<typeof getOctokit>
  ec2: EC2Client
}

export interface LaunchContext extends CoreContext {
  id: string

  runnerUser: string
  runnerDirectory: string

  instanceType: string
  subnetId: string
  securityGroupIds: string[]
  tags: [string, string][]

  amiName?: RegExp
  amiOwners?: string[]
  amiFilters: [string, string][]

  generateLabel(): string
}

export interface TerminateContext extends CoreContext {
  id: string

  instanceId: string
  label: string
}

export type Context =
  | [action: "launch", isMatrix: boolean, ctxs: LaunchContext[]]
  | [action: "terminate", isMatrix: boolean, ctxs: TerminateContext[]]

const launchOptionsSchema = z.object({
  "runner-user": z.string(),
  "runner-directory": z.string(),

  "instance-type": z.string(),
  "subnet-id": z.string(),
  "security-group-ids": z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),

  "ami-name": z.string().optional(),
  "ami-owner": z.array(z.string()).optional(),
  "ami-filters": z.array(z.string()).optional(),
})
const terminateOptionsSchema = z.object({
  "instance-id": z.string(),
  label: z.string(),
})

export type LaunchOptions = z.infer<typeof launchOptionsSchema>
export type TerminateOptions = z.infer<typeof terminateOptionsSchema>

type OfType<T, OT> = {
  [O in keyof T]-?: OT extends T[O] ? O : never
}[keyof T]
type Required<T> = {
  [O in keyof T]-?: undefined extends T[O] ? never : O
}[keyof T]

function getOption<T extends LaunchOptions | TerminateOptions>(
  matrix: T | undefined,
  name: OfType<T, string>,
  options: { required: false },
): string | undefined
function getOption<T extends LaunchOptions | TerminateOptions>(
  matrix: T | undefined,
  name: OfType<T, string> & Required<T>,
  options: { required: true },
): string
function getOption<T extends LaunchOptions | TerminateOptions>(
  matrix: T | undefined,
  name: OfType<T, string>,
  options: { required: boolean },
): string | undefined {
  if (matrix) {
    return matrix[name] as string | undefined
  }

  const value = core.getInput(name as string, options)
  return value !== "" ? value : undefined
}

function getMultiOption<T extends LaunchOptions | TerminateOptions>(
  matrix: T | undefined,
  name: OfType<T, string[]>,
  options: { required: false },
): string[] | undefined
function getMultiOption<T extends LaunchOptions | TerminateOptions>(
  matrix: T | undefined,
  name: OfType<T, string[]> & Required<T>,
  options: { required: true },
): string[]
function getMultiOption<T extends LaunchOptions | TerminateOptions>(
  matrix: T | undefined,
  name: OfType<T, string[]>,
  options: { required: boolean },
): string[] | undefined {
  if (matrix) {
    return matrix[name] as string[] | undefined
  }

  const value = core.getMultilineInput(name as string, options)
  return value.length > 0 ? value : undefined
}

function loggers(id: string): Loggers {
  const prefix = `[${id}] `
  return {
    debug: (msg) => core.debug(`${prefix}${msg}`),
    info: (msg) => core.info(`${prefix}${msg}`),
    warning: (msg) => core.warning(`${prefix}${msg.toString()}`),
    error: (msg) => core.error(`${prefix}${msg.toString()}`),
  }
}

export function getContext(): Context {
  core.debug("Reading core context")

  const githubToken = core.getInput("github-token", { required: true })
  const octokit = getOctokit(githubToken)
  const ec2 = new EC2Client({})

  const ctx = {
    github,
    githubToken,
    octokit,
    ec2,
  }

  const action = core.getInput("action", { required: true })
  switch (action) {
    case "launch": {
      core.debug("Reading launch context")

      const rawMatrix = core.getMultilineInput("matrix", { required: false })
      const isMatrix = rawMatrix.length > 0
      let matrix: Record<string, LaunchOptions | undefined>

      if (isMatrix) {
        try {
          matrix = z
            .record(z.string(), launchOptionsSchema)
            .parse(JSON.parse(rawMatrix.join("")))
        } catch {
          core.debug("Matrix is not valid JSON, treating as an identifier list")
          matrix = Object.fromEntries(rawMatrix.map((id) => [id, undefined]))
        }
      } else {
        matrix = { "": undefined }
      }

      const ctxs = Object.entries(matrix).map(([id, options]) => {
        const log = loggers(id)
        log.debug("Reading launch context")

        const runnerUser = getOption(options, "runner-user", { required: true })
        const runnerDirectory = getOption(options, "runner-directory", {
          required: true,
        })

        const instanceType = getOption(options, "instance-type", {
          required: true,
        })
        const subnetId = getOption(options, "subnet-id", { required: true })
        const securityGroupIds = getMultiOption(options, "security-group-ids", {
          required: false,
        })
        const tags = getMultiOption(options, "tags", { required: false })

        const amiName = getOption(options, "ami-name", { required: false })
        const amiOwners = getMultiOption(options, "ami-owner", {
          required: false,
        })
        const amiFilters = getMultiOption(options, "ami-filters", {
          required: false,
        })

        if (!amiName && !amiOwners && !amiFilters) {
          const error = new Error(
            `At least one of "ami-name", "ami-owner", or "ami-filters" must be specified`,
          )
          log.error(error)
          throw error
        }

        const generateLabel = () => {
          log.debug("Generating label")

          const ts = Date.now().toString(36).slice(-4)
          const rand = Math.random().toString(36).slice(-4)

          const labelPrefix = id ? `${id}-` : ""
          return `${labelPrefix}${ts}${rand}`
        }

        return {
          ...ctx,
          ...log,
          id,
          generateLabel,

          runnerUser,
          runnerDirectory,

          instanceType,
          subnetId,
          securityGroupIds: securityGroupIds ?? [],
          tags: tags?.map((t) => t.split("=", 2) as [string, string]) ?? [],

          amiName: amiName ? new RegExp(amiName) : undefined,
          amiOwners,
          amiFilters:
            amiFilters?.map((f) => f.split("=", 2) as [string, string]) ?? [],
        }
      })

      return ["launch", isMatrix, ctxs]
    }
    case "terminate": {
      core.debug("Reading terminate context")

      const rawMatrix = core.getInput("matrix", { required: false })
      const isMatrix = rawMatrix !== ""
      let matrix: Record<string, TerminateOptions | undefined>

      if (isMatrix) {
        matrix = z
          .record(z.string(), terminateOptionsSchema)
          .parse(JSON.parse(rawMatrix))
      } else {
        matrix = { "": undefined }
      }

      const ctxs = Object.entries(matrix).map(([id, options]) => {
        const log = loggers(id)
        log.debug("Reading terminate context")

        const instanceId = getOption(options, "instance-id", { required: true })
        const label = getOption(options, "label", { required: true })

        return {
          ...ctx,
          ...log,
          id,

          instanceId,
          label,
        }
      })

      return ["terminate", isMatrix, ctxs]
    }
    default: {
      throw new Error(`Invalid action "${action}"`)
    }
  }
}
