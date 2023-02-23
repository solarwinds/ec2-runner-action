import * as core from "@actions/core"
import {
  type Context,
  type LaunchContext,
  type TerminateContext,
} from "./context"

export interface Runner {
  id: number
  name: string
  status: string
  labels: { name: string }[]
}

export async function getRunner(
  ctx: Context,
  label: string,
): Promise<Runner | undefined> {
  core.debug(`Getting runner for label "${label}"`)

  let runners: Runner[] = []
  for (let page = 1; ; page++) {
    const res = await ctx.octokit.rest.actions.listSelfHostedRunnersForRepo({
      ...ctx.github.repo,
      per_page: 100,
      page,
    })

    core.debug(`Got ${res.data.runners.length} runners`)
    runners = [...runners, ...res.data.runners]

    if (runners.length === res.data.total_count) {
      return runners.find((r) => r.labels.some((l) => l.name === label))
    }
  }
}

export async function getRegistrationToken(
  ctx: LaunchContext,
): Promise<string> {
  core.debug("Getting registration token")

  try {
    const res = await ctx.octokit.request(
      "POST /repos/{owner}/{repo}/actions/runners/registration-token",
      ctx.github.repo,
    )
    return res.data.token
  } catch (error) {
    core.error("Error getting registration token")
    throw error
  }
}

export async function waitForRunner(
  ctx: LaunchContext,
  label: string,
): Promise<Runner> {
  const TIMEOUT = 10 * 60 * 1000
  const INTERVAL = 10 * 1000
  const WAIT = 30 * 1000

  core.debug("Waiting for runner to be online")

  core.debug(`Waiting ${WAIT}ms first`)
  await new Promise((res) => setTimeout(res, WAIT))

  let waited = 0
  const runner = await new Promise<Runner>((res, rej) => {
    const interval = setInterval(
      () =>
        void getRunner(ctx, label)
          .then((r) => {
            if (r && r.status === "online") {
              clearInterval(interval)
              res(r)
            } else {
              core.debug("Waiting for runner to be online")

              waited += INTERVAL
              if (waited > TIMEOUT) {
                clearInterval(interval)
                rej(new Error("Timed out waiting for runner to be online"))
              }
            }
          })
          .catch((err) => {
            core.error("Error waiting for runner to be online")
            rej(err)
          }),
      INTERVAL,
    )
  })

  return runner
}

export async function removeRunner(ctx: TerminateContext): Promise<void> {
  core.debug("Removing runner")

  try {
    const runner = await getRunner(ctx, ctx.label)
    if (!runner) {
      core.warning(
        `Runner for label "${ctx.label}" not found, skipping removal`,
      )
      return
    }

    await ctx.octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
      ...ctx.github.repo,
      runner_id: runner.id,
    })
  } catch (error) {
    core.error("Error removing runner")
    throw error
  }
}
