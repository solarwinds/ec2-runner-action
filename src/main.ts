import * as core from "@actions/core"
import { inspect } from "node:util"
import { selectAmi } from "./ami"
import { getContext, type TerminateOptions } from "./context"
import { launchInstance, terminateInstance, waitForInstance } from "./instance"
import { getRegistrationToken, removeRunner, waitForRunner } from "./runner"

function errorMessage(error: unknown): string | Error {
  if (typeof error === "string" || error instanceof Error) {
    return error
  } else {
    return inspect(error)
  }
}

async function run() {
  const [action, isMatrix, ctxs] = getContext()
  switch (action) {
    case "launch": {
      const tasks = ctxs.map(async (ctx) => {
        const label = ctx.generateLabel()
        const token = await getRegistrationToken(ctx)
        const ami = await selectAmi(ctx)

        const instance = await launchInstance(ctx, label, token, ami)

        await waitForInstance(ctx, instance)
        const runner = await waitForRunner(ctx, label)

        ctx.info(
          `Runner ${runner.name} (${
            runner.id
          }) with label "${label}" is online on EC2 instance ${instance.InstanceId!} using AMI ${ami.Name!} (${ami.ImageId!})`,
        )

        return [ctx, instance.InstanceId!, label] as const
      })

      const results = await Promise.allSettled(tasks)
      const output: Record<string, TerminateOptions> = {}
      let failed = false

      for (const result of results) {
        if (result.status === "fulfilled") {
          const [ctx, instanceId, label] = result.value
          output[ctx.id] = { "instance-id": instanceId, label }

          if (!isMatrix) {
            core.setOutput("instance-id", instanceId)
            core.setOutput("label", label)
          }
        } else {
          core.error(errorMessage(result.reason))
          failed = true
        }
      }

      core.setOutput("matrix", JSON.stringify(output))

      if (failed) {
        core.setFailed("One or more runners failed to launch")
      }
      break
    }
    case "terminate": {
      const tasks = ctxs.map(async (ctx) => {
        await terminateInstance(ctx)
        await removeRunner(ctx)

        ctx.info(
          `Runner with label "${ctx.label}" and EC2 instance ${ctx.instanceId} are offline`,
        )
      })

      const results = await Promise.allSettled(tasks)
      let failed = false

      for (const result of results) {
        if (result.status === "rejected") {
          core.error(errorMessage(result.reason))
          failed = true
        }
      }

      if (failed) {
        core.setFailed("One or more runners failed to terminate")
      }
    }
  }
}

run().catch((error) => core.setFailed(errorMessage(error)))
