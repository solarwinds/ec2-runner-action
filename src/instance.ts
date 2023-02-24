import {
  ResourceType,
  RunInstancesCommand,
  TerminateInstancesCommand,
  waitUntilInstanceRunning,
  type Image,
  type Instance,
} from "@aws-sdk/client-ec2"
import { type LaunchContext, type TerminateContext } from "./context"

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
    const output = await ctx.ec2.send(command)
    return output.Instances![0]!
  } catch (error) {
    ctx.error("Error launching instance")
    throw error
  }
}

export async function terminateInstance(ctx: TerminateContext): Promise<void> {
  ctx.debug("Terminating EC2 instance")

  try {
    await ctx.ec2.send(
      new TerminateInstancesCommand({
        InstanceIds: [ctx.instanceId],
      }),
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
