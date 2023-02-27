import {
  ResourceType,
  RunInstancesCommand,
  TerminateInstancesCommand,
  waitUntilInstanceRunning,
  EC2ServiceException,
  type Image,
  type Instance,
} from "@aws-sdk/client-ec2"
import {
  type CoreContext,
  type LaunchContext,
  type TerminateContext,
} from "./context"

export async function launchInstance(
  ctx: LaunchContext,
  label: string,
  token: string,
  ami: Image,
): Promise<Instance> {
  ctx.debug("Launching EC2 instance")

  const userData = [
    "#!/bin/sh",
    `cd ${ctx.runnerDirectory}`,
    `sudo -u ${ctx.runnerUser} ./config.sh --unattended --url https://github.com/${ctx.github.repo.owner}/${ctx.github.repo.repo} --labels ${label} --token ${token}`,
    `sudo -u ${ctx.runnerUser} ./run.sh`,
  ]
  const tags = ctx.tags?.map(([key, value]) => ({ Key: key, Value: value }))

  const command = new RunInstancesCommand({
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join("\n")).toString("base64"),
    ImageId: ami.ImageId,
    InstanceType: ctx.instanceType,
    SubnetId: ctx.subnetId,
    SecurityGroupIds: ctx.securityGroupIds,
    TagSpecifications: tags && [
      { ResourceType: ResourceType.instance, Tags: tags },
      { ResourceType: ResourceType.volume, Tags: tags },
    ],
  })

  try {
    const output = await retryIfRateLimited(ctx, () => ctx.ec2.send(command))
    return output.Instances![0]!
  } catch (error) {
    ctx.error("Error launching instance")
    throw error
  }
}

export async function terminateInstance(ctx: TerminateContext): Promise<void> {
  ctx.debug("Terminating EC2 instance")

  try {
    await retryIfRateLimited(ctx, () =>
      ctx.ec2.send(
        new TerminateInstancesCommand({
          InstanceIds: [ctx.instanceId],
        }),
      ),
    )
  } catch (error) {
    ctx.error("Error terminating instance")
    throw error
  }
}

export async function waitForInstance(
  ctx: LaunchContext,
  instance: Instance,
): Promise<void> {
  const MAX_WAIT_TIME = 5 * 60

  for (;;) {
    ctx.debug("Waiting for EC2 instance to be running")
    try {
      const result = await waitUntilInstanceRunning(
        { client: ctx.ec2, maxWaitTime: MAX_WAIT_TIME },
        { InstanceIds: [instance.InstanceId!] },
      )
      switch (result.state) {
        case "SUCCESS": {
          return
        }
        case "RETRY": {
          continue
        }
        default: {
          throw new Error((result.reason ?? result.state) as string)
        }
      }
    } catch (error) {
      ctx.error("Error waiting for EC2 instance to be running")
      throw error
    }
  }
}

function retryIfRateLimited<T>(
  ctx: CoreContext,
  op: () => Promise<T>,
  options?: { timeout?: number; retries?: number },
): Promise<T> {
  const timeout = options?.timeout ?? 10 * 1000
  const retries = options?.retries ?? 6

  let retried = 0
  return new Promise((res, rej) => {
    const interval = setInterval(() => {
      op()
        .then((r) => res(r))
        .catch((err) => {
          retried += 1
          if (
            retried >= retries ||
            !(err instanceof EC2ServiceException && err.$retryable)
          ) {
            clearInterval(interval)
            return rej(err)
          }

          ctx.debug("Rate limited")
        })
    }, timeout)
  })
}
