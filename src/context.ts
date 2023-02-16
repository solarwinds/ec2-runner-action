import * as core from "@actions/core"
import { context as github, getOctokit } from "@actions/github"
import { EC2Client } from "@aws-sdk/client-ec2"

interface CoreContext {
  github: typeof github
  githubToken: string
  octokit: ReturnType<typeof getOctokit>
  ec2: EC2Client
}

export interface LaunchContext extends CoreContext {
  action: "launch"

  runnerUser: string
  runnerDirectory: string

  instanceType: string
  subnetId: string
  securityGroupIds: string[]
  tags: [string, string][]

  amiName?: RegExp
  amiOwners?: string[]
  amiFilters: [string, string][]
}

export interface TerminateContext extends CoreContext {
  action: "terminate"

  instanceId: string
  label: string
}

export type Context = LaunchContext | TerminateContext

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

      const runnerUser = core.getInput("runner-user", { required: true })
      const runnerDirectory = core.getInput("runner-directory", {
        required: true,
      })

      const instanceType = core.getInput("instance-type", { required: true })
      const subnetId = core.getInput("subnet-id", { required: true })
      const securityGroupIds = core.getMultilineInput("security-group-ids", {
        required: false,
      })
      const tags = core.getMultilineInput("tags", { required: false })

      const amiName = core.getInput("ami-name", { required: false })
      const amiOwners = core.getMultilineInput("ami-owner", { required: false })
      const amiFilters = core.getMultilineInput("ami-filters", {
        required: false,
      })

      if (!amiName && !amiOwners.length && !amiFilters.length) {
        throw new Error(
          `At least one of "ami-name", "ami-owner", or "ami-filters" must be specified`,
        )
      }

      return {
        ...ctx,
        action,

        runnerUser,
        runnerDirectory,

        instanceType,
        subnetId,
        securityGroupIds,
        tags: tags.map((t) => t.split("=", 2) as [string, string]),

        amiName: amiName ? new RegExp(amiName) : undefined,
        amiOwners: amiOwners.length ? amiOwners : undefined,
        amiFilters: amiFilters.map((f) => f.split("=", 2) as [string, string]),
      }
    }
    case "terminate": {
      core.debug("Reading terminate context")

      const instanceId = core.getInput("instance-id", { required: true })
      const label = core.getInput("label", { required: true })

      return {
        ...ctx,
        action,

        instanceId,
        label,
      }
    }
    default: {
      throw new Error(`Invalid action "${action}"`)
    }
  }
}

export function generateLabel(): string {
  core.debug("Generating label")

  const ts = Date.now().toString(36).slice(-4)
  const rand = Math.random().toString(36).slice(-4)
  return `${ts}${rand}`
}
