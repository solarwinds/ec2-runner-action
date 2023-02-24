import * as core from "@actions/core"
import { inspect } from "node:util"
import { selectAmi } from "./ami"
import {
  getContext,
  type LaunchContext,
  type TerminateContext,
  type TerminateOptions,
} from "./context"
import { launchInstance, terminateInstance, waitForInstance } from "./instance"
import { getRegistrationToken, removeRunner, waitForRunner } from "./runner"

function errorMessage(error: unknown): string | Error {
  if (typeof error === "string" || error instanceof Error) {
    return error
  } else {
    return inspect(error)
  }
}

/*
start by parsing the context which will return which action is to be performed,
whether the input was a matrix or not, and the an array of contexts for each runner
(if it was not a matrix then there is a single element in the array)

then for each context we perform the action as a promise and add the context to the error
in case of failure. we wait for all promises to have either resolved or rejected and then
collect the results. if any of the tasks fail we mark the entire job as failed but still make sure
to add any successful runners to the output so they can be terminated. we log each error
using the context that was added to it so that the user can see which runner failed
*/

async function run() {
  const [action, isMatrix, ctxs] = getContext()
  core.debug(inspect({ action, ctxs }, { depth: 6 }))

  switch (action) {
    case "launch": {
      const tasks = ctxs.map((ctx) =>
        (async () => {
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
        })().catch((error) => Promise.reject([ctx, error])),
      )

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
          const [ctx, error] = result.reason as [LaunchContext, unknown]
          ctx.error(errorMessage(error))
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
      const tasks = ctxs.map((ctx) =>
        (async () => {
          await terminateInstance(ctx)
          await removeRunner(ctx)

          ctx.info(
            `Runner with label "${ctx.label}" and EC2 instance ${ctx.instanceId} are offline`,
          )
        })().catch((error) => Promise.reject([ctx, error])),
      )

      const results = await Promise.allSettled(tasks)
      let failed = false

      for (const result of results) {
        if (result.status === "rejected") {
          const [ctx, error] = result.reason as [TerminateContext, unknown]
          ctx.error(errorMessage(error))
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
