import * as core from "@actions/core"
import { selectAmi } from "./ami"
import { getContext, generateLabel } from "./context"
import { launchInstance, terminateInstance, waitForInstance } from "./instance"
import { getRegistrationToken, removeRunner, waitForRunner } from "./runner"

async function run() {
  const ctx = getContext()
  switch (ctx.action) {
    case "launch": {
      const label = generateLabel()
      const token = await getRegistrationToken(ctx)
      const ami = await selectAmi(ctx)

      const instance = await launchInstance(ctx, label, token, ami)

      await waitForInstance(ctx, instance)
      const runner = await waitForRunner(ctx, label)

      core.info(
        `Runner ${runner.name} (${
          runner.id
        }) with label "${label}" is online on EC2 instance ${instance.InstanceId!}`,
      )

      core.setOutput("instance-id", instance.InstanceId)
      core.setOutput("label", label)
      break
    }
    case "terminate": {
      await terminateInstance(ctx)
      await removeRunner(ctx)

      core.info(
        `Runner with label "${ctx.label}" and EC2 instance ${ctx.instanceId} are offline`,
      )
    }
  }
}

run().catch((error) => {
  let message = "Unknown error"
  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === "string") {
    message = error
  }
  core.setFailed(message)
})
