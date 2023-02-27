# EC2 GitHub Actions Runner

## Single

```yml
launch-runner:
  runs-on: ubuntu-latest
  outputs:
    label: ${{ steps.launch.outputs.label }} # github runner label
    instance-id: ${{ steps.launch.outputs.instance-id }} # ec2 instance id
  steps:
    - uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ secrets.AWS_REGION }}
    - id: launch
      uses: solarwindscloud/ec2-runner-action@main
      with:
        action: launch
        github-token: ${{ secrets.GITHUB_TOKEN }}
        runner-user: github # existing user
        runner-directory: /github/actions # existing directory containing the runner scripts
        instance-type: t4g.medium
        ami-name: actions-runner-.+ # the most recent ami matching this regex will be picked
        ami-owner: abc12 # only amis from this owner will be considered
        subnet-id: def34
        security-group-ids: | # one id per line
          hij56
          klm78

work:
  needs: launch-runner
  runs-on: ${{ needs.launch-runner.outputs.label }}
  steps:
    - run: echo "Hello from EC2 !"

terminate-runner:
  needs:
    - launch-runner
    - work # don't terminate until the job is complete
  runs-on: ubuntu-latest
  if: ${{ always() }} # need to terminate the instance even if the workflow failed
  steps:
    - uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ secrets.AWS_REGION }}
    - uses: solarwindscloud/ec2-runner-action@main
      with:
        action: terminate
        github-token: ${{ secrets.GITHUB_TOKEN }}
        label: ${{ needs.launch-runner.outputs.label }}
        instance-id: ${{ needs.launch-runner.outputs.instance-id }}
```

## Matrix (simple)

```yml
launch-runners:
  runs-on: ubuntu-latest
  outputs:
    matrix: ${{ steps.launch.outputs.matrix }} # this will be a json object mapping identifiers to labels and instance ids
  steps:
    - uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ secrets.AWS_REGION }}
    - id: launch
      uses: solarwindscloud/ec2-runner-action@main
      with:
        action: launch
        matrix: | # one identifier per line
          job1
          job2
        github-token: ${{ secrets.GITHUB_TOKEN }}
        runner-user: github
        runner-directory: /github/actions
        instance-type: t4g.medium
        ami-name: actions-runner-.+
        ami-owner: abc12
        subnet-id: def34
        security-group-ids: |
          hij56
          klm78

work:
  needs: launch-runners
  strategy:
    matrix:
      job:
        - job1
        - job2
  runs-on: ${{ fromJSON(needs.launch-runners.outputs.matrix)[matrix.job].label }} # parse the matrix output, index by identifier, and grab the label
  steps:
    - run: echo "Hello from EC2 ${{ matrix.job }} !"

terminate-runners:
  needs:
    - launch-runners
    - work
  runs-on: ubuntu-latest
  if: ${{ always() }}
  steps:
    - uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ secrets.AWS_REGION }}
    - uses: solarwindscloud/ec2-runner-action@main
      with:
        action: terminate
        github-token: ${{ secrets.GITHUB_TOKEN }}
        matrix: ${{ needs.launch-runner.outputs.matrix }} # passing a matrix will terminate all runners, not just one
```

## Matrix (complex)

```yml
launch-runners:
  runs-on: ubuntu-latest
  outputs:
    matrix: ${{ steps.launch.outputs.matrix }} # this will be a json object mapping identifiers to labels and instance ids
  steps:
    - uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ secrets.AWS_REGION }}
    - id: launch
      uses: solarwindscloud/ec2-runner-action@main
      with:
        action: launch
        matrix: | # everything is provided as json
          {
            "job1": {
              "runner-user": "github",
              "runner-directory": "/github/actions",
              "instance-type": "t4g.medium",
              "ami-name": "actions-runner-1-.+",
              "ami-owner": ["acb12"],
              "subnet-id": "def32",
              "security-group-ids": [
                "hij56",
                "klm78"
              ]
            },
            "job2": {
              "runner-user": "github",
              "runner-directory": "/github/actions",
              "instance-type": "t4g.medium",
              "ami-name": "actions-runner-2-.+",
              "ami-owner": ["acb12"],
              "subnet-id": "def32",
              "security-group-ids": [
                "nop90"
              ]
            }
          }

work:
  needs: launch-runners
  strategy:
    matrix:
      job:
        - job1
        - job2
  runs-on: ${{ fromJSON(needs.launch-runners.outputs.matrix)[matrix.job].label }}
  steps:
    - run: echo "Hello from EC2 ${{ matrix.job }} !"

terminate-runners:
  needs:
    - launch-runners
    - work
  runs-on: ubuntu-latest
  if: ${{ always() }}
  steps:
    - uses: aws-actions/configure-aws-credentials@v1
      with:
        aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
        aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        aws-region: ${{ secrets.AWS_REGION }}
    - uses: solarwindscloud/ec2-runner-action@main
      with:
        action: terminate
        github-token: ${{ secrets.GITHUB_TOKEN }}
        matrix: ${{ needs.launch-runner.outputs.matrix }}
```
