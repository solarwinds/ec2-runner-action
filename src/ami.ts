import * as core from "@actions/core"
import {
  DescribeImagesCommand,
  type DescribeImagesCommandInput,
  type Image,
} from "@aws-sdk/client-ec2"
import { type LaunchContext } from "./context"

export async function selectAmi(ctx: LaunchContext): Promise<Image> {
  core.debug("Selecting AMI")

  const input: DescribeImagesCommandInput = {
    ExecutableUsers: ["self"],
    Owners: ctx.amiOwners,
    Filters: ctx.amiFilters.map(([name, value]) => ({
      Name: name,
      Values: [value],
    })),
    IncludeDeprecated: false,
  }

  let images: Image[] = []
  do {
    try {
      const output = await ctx.ec2.send(new DescribeImagesCommand(input))

      if (output.Images) {
        core.debug(`Got ${output.Images.length} AMIs`)
        images = [...images, ...output.Images]
      }

      input.NextToken = output.NextToken
    } catch (error) {
      core.error("Error selecting AMI")
      throw error
    }
  } while (input.NextToken)

  if (ctx.amiName) {
    images = images.filter((i) => i.Name && ctx.amiName?.test(i.Name))
  }

  if (!images.length) {
    throw new Error("No AMIs found matching filters")
  }

  return images.sort(
    (a, b) =>
      new Date(b.CreationDate ?? 0).getUTCSeconds() -
      new Date(a.CreationDate ?? 0).getUTCSeconds(),
  )[0]
}
