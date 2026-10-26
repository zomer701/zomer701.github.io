---
title: "Running Claude Code on AWS Lambda with your Claude subscription"
excerpt: "No servers, no API key, no always-on laptop. Just a durable Lambda that checks out a repo, has Claude Code review it, and drops a Markdown report in S3."
toc: true
toc_sticky: true
tags: [aws, lambda, claude-code, typescript, serverless]
---

I wanted Claude Code to review my repositories on its own. Not in a terminal I have to keep open, and not on a server I have to patch. I wanted to send one request, go make coffee, and come back to a report.

I also didn't want a second bill. I already pay for a Claude subscription, so I wanted to use it instead of a separate API key.

This post covers how I got there with **AWS Lambda durable functions**. It also covers the one trap that would have bitten me, and the open-source TypeScript code you can run in five minutes:

👉 **[github.com/zomer701/claude-durable-lambda](https://github.com/zomer701/claude-durable-lambda)**

## The idea in one picture

```text
  you ──► { jobId, repoUrl }
              │
              ▼
   ┌──────────────── Durable Lambda ─────────────────┐
   │  step: review-security  ──► S3  security.md     │
   │  step: review-bugs      ──► S3  bugs.md         │
   │  step: review-tests     ──► S3  tests.md        │
   │  step: summary          ──► S3  summary.md      │
   └─────────────────────────────────────────────────┘
              ▲
   Secrets Manager: Claude OAuth token
```

Each box is a separate run of the unmodified `claude` CLI, in headless mode (`claude -p`), inside a Lambda container. The durable runtime remembers which boxes finished. If the "bugs" run crashes, Lambda retries only that one. The finished security review isn't redone or paid for twice.

## Step 0: try it on your laptop

Before any AWS, here's the same review running locally with the Claude login you already have:

```bash
git clone https://github.com/zomer701/claude-durable-lambda
cd claude-durable-lambda && npm install
npm run review:local
```

It reviews a tiny, deliberately broken user service in `examples/sample-app`. This is the real output from my run:

```text
Reviewing security... done in 17s
Reviewing bugs... done in 14s
Reviewing tests... done in 19s
Writing summary... done

## Top 5 fixes (in priority order)

1. SQL injection in findUser (users.ts:13): email is put directly
   into the SQL string. Switch to a parameterized query.
2. Hardcoded admin token (users.ts:10): anyone who can read the repo
   has admin access. Load it from a secret store and rotate it.
3. login crashes for unknown emails (users.ts:22-23): user is
   undefined, so user.password_hash throws.
4. Unsalted MD5 password hashing (users.ts:18): use argon2id,
   bcrypt or scrypt.
5. Off-by-one in pageOfUsers (users.ts:33-35): returns size + 1
   items, so pages overlap.
```

It found every bug I planted, and it gave line numbers. Point it at your own code with `npm run review:local -- ../my-project`.

## How Claude Code logs in without you

Claude Code has a command for exactly this situation:

```bash
claude setup-token
```

It runs the normal browser sign-in once and prints a **long-lived OAuth token** meant for scripts and CI. If you set that token as `CLAUDE_CODE_OAUTH_TOKEN`, `claude -p` runs against your subscription without any login prompt.

So the setup is:

1. Run `claude setup-token` on a machine you trust.
2. Put the token in **AWS Secrets Manager**. Don't put it in an environment variable, a `.env` file, or Git.
3. Let the Lambda's role read that one secret, and nothing else.

```bash
read -rs TOKEN && aws secretsmanager create-secret \
  --name claude-code/oauth-token --secret-string "$TOKEN"; unset TOKEN
```

The `read -rs` trick keeps the token out of your shell history.

One gotcha: **don't use `--bare`.** Bare mode skips subscription login entirely, so you'd get auth errors.

## The small SDK that makes it safe

Starting a CLI from Lambda is easy. Starting it *safely* takes a few details. They all live in one function, `runClaude()`:

```ts
const result = await runClaude({
  prompt: reviewPrompt("security"),
  cwd: "/tmp/jobs/demo-001/security",
  oauthToken: await getOAuthToken("claude-code/oauth-token"),
  timeoutMs: 10 * 60_000,
  home: "/tmp",
});
```

Here's what it does under the hood, and why:

- **It sandboxes the CLI.** It passes `--restricted --tools Read,Glob,Grep --strict-mcp-config`. Claude can read the code, but can't run shell commands, fetch URLs, or load hooks and settings from the repo it's reviewing. That last part matters. A repo you review is *untrusted input*, and it shouldn't be able to configure the tool reviewing it.
- **It blocks surprise billing.** It removes `ANTHROPIC_API_KEY`, the Bedrock and Vertex switches, and custom base URLs from the child's environment. If something's misconfigured, the run fails loudly instead of quietly billing an API key.
- **It hides your AWS keys from Claude.** Lambda puts the role's credentials in the environment. The CLI doesn't need them, so the SDK strips them.
- **It avoids shell injection.** The prompt goes in on stdin, and arguments are an array. Nothing passes through a shell.
- **It enforces a deadline.** The CLI is killed at `timeoutMs`, and you get a `TASK_TIMEOUT` error instead of a frozen Lambda.
- **It explains failures.** Every failure becomes one of `AUTH_REQUIRED`, `SUBSCRIPTION_LIMIT`, `TASK_TIMEOUT`, or `CLI_ERROR`. Only `CLI_ERROR` is retried. Retrying a dead token or a used-up limit just wastes time.

I checked the last one against the real CLI. In a read-only container with no token, `claude` says `Not logged in · Please run /login`, and the SDK reports `AUTH_REQUIRED`.

## Durable functions, and the trap

[Lambda durable functions](https://docs.aws.amazon.com/lambda/latest/dg/durable-functions.html) let you write a workflow as ordinary code. Each `context.step()` saves its result. If the function fails, or waits, Lambda runs your code again from the top, and finished steps return their saved results immediately.

Here's the core of the workflow:

```ts
export const handler = withDurableExecution(async (event, context) => {
  const job = validateEvent(event);

  for (const focus of job.focus) {            // security, bugs, tests
    await context.step(`review-${focus}`, async () => {
      const dir = `/tmp/jobs/${job.jobId}/${focus}`;
      await cloneRepo(job.repoUrl, dir);
      const result = await runClaude({ prompt: reviewPrompt(focus), cwd: dir, ... });
      return { key: await saveReport(`reports/${job.jobId}/${focus}.md`, result.text) };
    }, { retryStrategy });
  }

  await context.step("summary", async () => { /* read reports, one more Claude run */ });
});
```

Now the trap. **A checkpoint saves *finished* steps. It does not freeze a running process.**

When I first read "durable", I pictured Lambda pausing Claude mid-thought and resuming it later. That's not how it works. If a Claude run is halfway through when the invocation ends, that run is gone. The step starts over from scratch.

That leads to three rules:

1. **One Claude run must fit in one invocation.** Lambda caps an invocation at 15 minutes. I kill the CLI at 10, so there's time left to upload and checkpoint. If a job is bigger than that, split it into more steps.
2. **`/tmp` isn't storage.** The next invocation might run on a fresh machine. So each step clones the repo, uses it, and deletes it, all in one step.
3. **Keep checkpoints small.** Steps return an S3 key, not the report itself. The reports live in S3.

There's one more subtle problem. A step can finish its work and crash *right before* it saves its checkpoint, and then it runs again. That's why report keys are deterministic (`reports/<jobId>/<focus>.md`). A rerun overwrites the same file instead of leaving duplicates.

## Testing a durable workflow locally

AWS ships a local test runner for durable functions. It made testing the workflow fun. I swap in fake versions of git, Secrets Manager, Claude, and S3, and run the real workflow:

```ts
it("retries a flaky Claude run without redoing finished steps", async () => {
  // the "bugs" run crashes once...
  const execution = await runner.run({ payload: { jobId: "job-2", repoUrl, focus: ["security", "bugs"] } });

  expect(execution.getStatus()).toBe("SUCCEEDED");
  expect(bugsAttempts).toBe(2);           // retried
  expect(securityRuns).toHaveLength(1);   // ...but security did NOT run again
});
```

There's another test for an expired token. The workflow fails after exactly one attempt and doesn't retry. All 18 tests run in under a second with `npm test`.

## Deploying it

The repo has a SAM template that creates the durable function from a container image, an encrypted S3 bucket for reports, and a role that can read only your token secret.

```bash
sam build
sam deploy --guided
```

Then start a review. Durable functions must be called through a **version or alias**, and an async invoke means you don't wait on the line:

```bash
aws lambda invoke --function-name <ReviewFunctionAlias ARN> \
  --invocation-type Event --cli-binary-format raw-in-base64-out \
  --payload '{"jobId":"demo-001","repoUrl":"https://github.com/zomer701/claude-durable-lambda"}' \
  /dev/null
```

You can watch each step tick off in the Lambda console under **Durable executions**. When it's done, the summary is waiting in S3.

A few settings worth knowing:

| Setting | Value | Why |
|---|---|---|
| `Timeout` | 900 s | Lambda's per-invocation maximum |
| `CLAUDE_TIMEOUT_MS` | 600000 | Leaves 5 minutes to upload and checkpoint |
| `DurableConfig.ExecutionTimeout` | 1 day | The whole review, retries included |
| `ReservedConcurrentExecutions` | 2 | Every run shares *your* subscription limits |
| `Architectures` | arm64 | Cheaper, and Claude Code runs fine on it |

## The fine print: this is for *you*

I want to be clear about this part. A Claude subscription belongs to one person. This setup is for **your own automation on your own code**: your repos, your reviews, your usage limits.

Don't turn it into a service that runs other people's requests through your subscription, and never collect someone else's Claude login. If you're building a product with other users, use the Claude API or Amazon Bedrock, where each customer has their own billing. Anthropic explains the rules on its [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) and in [using Claude Code with your plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). Read them before you rely on this.

Also, tokens can expire or be revoked early. When that happens you'll see `AUTH_REQUIRED`. Run `claude setup-token` again and update the secret.

## What I'd add next

- **A trigger on every push.** Have a GitHub webhook or EventBridge start a review automatically.
- **Memory between reviews.** Save confirmed findings to DynamoDB, so the next review knows what you've already decided to ignore.
- **Human approval.** Use a durable callback to pause until you approve, before anything is allowed to write code.

The code is MIT-licensed and small enough to read in one sitting:
**[github.com/zomer701/claude-durable-lambda](https://github.com/zomer701/claude-durable-lambda)**.
