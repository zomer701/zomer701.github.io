---
title: "A free Cloudflare front door for my Claude Code Lambda"
excerpt: "Start code reviews from your phone with one curl. Cloudflare checks the key, rate limits by real IP, and tells Lambda who's calling, in a way nobody can fake."
toc: true
toc_sticky: true
tags: [cloudflare, aws, lambda, security, claude-code]
---

In the [last post](/2026/10/26/claude-code-on-aws-lambda/) I got Claude Code reviewing repositories inside an AWS Lambda durable function, using my own Claude subscription. It worked, but starting a review meant running `aws lambda invoke` with the right ARN. That's fine at my desk, but awkward from my phone or a CI job.

I wanted this instead:

```bash
curl -X POST https://my-reviews.workers.dev/reviews \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"repoUrl":"https://github.com/zomer701/claude-durable-lambda"}'
```

I also didn't want to pay for it. Lambda has function URLs, but a public URL on the internet attracts bots, scanners, and anyone who guesses it. So I put a **Cloudflare Worker** in front. The free plan includes 100,000 requests a day, which is about 99,990 more than I need.

All the code is in the same repo: **[github.com/zomer701/claude-durable-lambda](https://github.com/zomer701/claude-durable-lambda)** (`edge/` and `lambda/api.ts`).

## The shape of it

```text
you ──HTTPS──► Cloudflare Worker ──────────────► API Lambda ─────► durable review
               1. IP allowlist (optional)        5. check origin secret
               2. rate limit per IP              6. trust x-client-ip
               3. check your API key             7. start review, log who asked
               4. add origin secret + real IP
```

Two small pieces:

- **The Worker** (`edge/src/index.ts`) is about 80 lines. It's the only thing on the public internet that matters.
- **The API Lambda** (`lambda/api.ts`) accepts `POST /reviews` and `GET /reviews/<id>`. It starts the durable review asynchronously and answers `202` right away.

## Why not just Cloudflare DNS?

The classic setup is a domain on Cloudflare with an orange-cloud record pointing at your server. With a Lambda function URL that breaks. The function URL expects its own hostname in the `Host` header, and the free plan can't rewrite it.

A Worker sidesteps that. It makes a fresh `fetch()` to the function URL, so the host is always right. You also get a free `*.workers.dev` address, so you don't need your own domain.

## The interesting part: knowing who's calling, for real

Here's the subtle bit, and the reason I'm writing this up.

**Lambda can't see your visitor's IP.** It sees Cloudflare's IP, because Cloudflare is the one connecting. Cloudflare knows the real one and puts it in the `CF-Connecting-IP` header.

So the Worker passes it along as `x-client-ip`. Problem solved?

Not quite. **Anyone can send a header called `x-client-ip`.** If the Lambda simply believed it, I could curl the function URL directly with `x-client-ip: 1.2.3.4` and pretend to be anyone. Every "real IP" setup has this trap. A forwarded IP header is only as trustworthy as whoever added it.

The fix is a shared secret between the Worker and the Lambda:

1. AWS generates a random **origin secret** in Secrets Manager when you deploy, so you never invent or see it in a template.
2. You copy it into the Worker with `wrangler secret put`.
3. The Worker adds it to every request it forwards.
4. The Lambda compares it in constant time. **No secret, no service**, and only then does it believe `x-client-ip`.

```ts
// lambda/api.ts
if (!sameSecret(headers["x-origin-secret"], await deps.getOriginSecret())) {
  log({ msg: "rejected_direct_call", sourceIp: event.requestContext.http.sourceIp });
  return json(403, { error: "forbidden" });
}

const client = {
  ip: headers["x-client-ip"] ?? "unknown",
  country: headers["x-client-country"] ?? "unknown",
};
```

There's one more detail on the Worker side. **It builds the outgoing headers from scratch** instead of copying the incoming ones. If a caller sends their own `x-client-ip` or a guessed `x-origin-secret`, those headers never reach Lambda:

```ts
// edge/src/index.ts
const origin = await fetch(new URL(url.pathname, env.ORIGIN_URL), {
  method: request.method,
  body,
  headers: {
    "content-type": "application/json",
    "x-origin-secret": env.ORIGIN_SECRET,
    "x-client-ip": ip,              // from CF-Connecting-IP, set by Cloudflare
    "x-client-country": country,    // from request.cf.country
  },
});
```

## What the real IP buys you

With an IP you can trust, a few useful things become easy:

- **Rate limiting.** Each IP gets 10 requests a minute. A leaked key can't be used to hammer your subscription, and the limit applies *before* the key check, so nobody can try thousands of keys either.
- **An optional allowlist.** Set `ALLOWED_IPS` to your home and CI addresses, and everything else gets `403` before it costs you anything.
- **An audit trail.** Every review logs who started it, and the IP and country travel with the job into its result:

```json
{"msg":"review_started","jobId":"r-mvpeheoz-010bfe","repoUrl":"https://github.com/...","ip":"203.0.113.7","country":"UA"}
```

## I tested it locally, with real Cloudflare code

`wrangler dev` runs the Worker on Cloudflare's actual runtime on your laptop. I put it in front of a local server running the same API code, then attacked it:

```text
1 direct to origin, no secret:
{"error":"forbidden"}
2 no key:
{"error":"unauthorized"}
3 good request (+ spoofed ip header):
{"jobId":"r-mvpeheoz-010bfe","status":"RUNNING","check":"/reviews/r-mvpeheoz-010bfe"}
4 status:
{"jobId":"r-abc","status":"RUNNING"}
5 rate limit (12 quick calls):
202 202 202 202 202 202 429 429 429 429 429 429
```

In test 3, I sent `x-client-ip: 6.6.6.6`. The origin log shows my real address instead. The spoofed header never made it through. The rate limit kicked in after 10 requests that minute, counting the earlier calls.

Unit tests cover the same cases (`npm test`, now 32 tests).

## Setting it up

After the main stack is deployed with `sam deploy`:

```bash
cd edge && npm install

# 1. Paste the ApiUrl stack output into wrangler.jsonc as ORIGIN_URL

# 2. Copy the origin secret from AWS straight into Cloudflare
aws secretsmanager get-secret-value --secret-id <OriginSecretArn> \
  --query SecretString --output text | npx wrangler secret put ORIGIN_SECRET

# 3. Make yourself an API key (printed once so you can save it)
openssl rand -hex 24 | tee /dev/stderr | npx wrangler secret put API_KEY

npx wrangler deploy
```

The secrets travel through pipes, so they never appear in a file or in your shell history.

Then, from anywhere:

```bash
curl -X POST https://claude-review-edge.<you>.workers.dev/reviews \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"repoUrl":"https://github.com/you/your-repo"}'

# later
curl https://claude-review-edge.<you>.workers.dev/reviews/<jobId> \
  -H "Authorization: Bearer $API_KEY"
```

The second call returns `202` while Claude is still reading, then the summary as Markdown.

## Good to know

- **Cloudflare's rate limits are approximate.** Cloudflare counts per data center and syncs in the background, so a burst can slightly exceed the limit. That's fine for "stop the bots". If you need an exact global count, Cloudflare suggests Durable Objects.
- **The function URL is still public**, just useless without the secret. If you want AWS itself to reject strangers, switch the URL to `AWS_IAM` auth and have the Worker sign requests. That's more setup, and the shared secret is plenty for a personal tool.
- **Rotate secrets now and then.** Rotate the origin secret in Secrets Manager, then run `wrangler secret put` again. Same for your API key.

## The key keeps it *yours*

One thing this is **not**: a way to share your Claude subscription. The API key exists so that only *you* can start reviews. Your phone, your CI, your repos.

If you want other people to use something like this, give them their own access. The Claude API or Amazon Bedrock bill each user properly. A personal subscription behind a public endpoint breaks the rules and can get your account banned. I wrote more about the rules in the [first post](/2026/10/26/claude-code-on-aws-lambda/#the-fine-print-this-is-for-you).

## Wrapping up

The whole front door is a free Worker, one generated secret, and under 200 lines of TypeScript:

- Your endpoint gets a real address, rate limits, and an audit log.
- Nobody can fake who they are.
- Calls that skip Cloudflare get a `403`.

Code: **[github.com/zomer701/claude-durable-lambda](https://github.com/zomer701/claude-durable-lambda)**. Questions or ideas? Find me on [LinkedIn](https://www.linkedin.com/in/mykhailo-markhain-06635093/).
