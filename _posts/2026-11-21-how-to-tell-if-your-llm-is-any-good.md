---
title: "How to tell if your LLM or AI agent is actually any good"
excerpt: "A plain-English guide to evaluating language models and agents: when people should grade, when code can grade, how to build an LLM judge you can trust, how to find out why an agent failed, and why public leaderboards can fool you."
toc: true
toc_sticky: true
tags: [llm, evaluation, ai-agents, llm-as-a-judge, benchmarks]
---

You changed a prompt, swapped a model or added a tool. Did things get better or worse? With normal code you'd run the tests. With a language model, "the tests" are much harder to write, and most teams end up guessing.

This post is about how to stop guessing.

## Why this is harder than it looks

There are four reasons evaluating a model is hard:

- **One model does many jobs.** The same model writes code, solves math, drafts emails and summarizes reports. No single score fits all of that.
- **Good has many sides.** An answer can be correct and relevant and still have the wrong tone.
- **There's often no single right answer.** Ask for a product description and a hundred different answers could all be fine.
- **Agents take many steps.** When an agent observes, plans and acts over many turns, a wrong final answer could have gone wrong at any step.

{% include figure image_path="/assets/images/llm-evaluation/01-why-evaluation-is-hard.jpg" alt="Icons for many tasks, many quality checks, many valid answers and an agent loop" caption="Many tasks, many qualities, many valid answers, many steps." %}

It also helps to know *what* you are measuring. Most things fall into three buckets:
- **Quality:** is it correct, relevant and safe?
- **Reliability:** is it consistent and fast, and does it recover from errors?
- **Product impact:** do people actually use it and get what they need?

## Asking people to grade

The most obvious approach is to have people read answers and grade them. It works, but it has three problems: it is slow, it is expensive, and people disagree.

Disagreement is a bigger deal than it sounds. "Is this answer correct?" usually gets the same verdict from everyone. "Is this answer useful?" often doesn't, because each person imagines a different situation. So if you use human graders, write clear grading guidelines and **measure how often they agree**.

There's a catch with measuring agreement. Two people who flip coins will still agree half the time on a pass/fail question. Raw agreement looks better than it really is. **Cohen's kappa** fixes this by subtracting the agreement you'd expect by luck:

```
kappa = (observed agreement - agreement by chance) / (1 - agreement by chance)
```

It runs from -1 to 1. Around 0.8 is solid for subjective questions; much lower means your guidelines need work before the grades mean anything.

{% include figure image_path="/assets/images/llm-evaluation/02-rater-agreement.jpg" alt="Two reviewers marking the same answers, with matching rows highlighted" caption="Agreement only counts if it beats what coin flips would give you." %}

## Letting code do the grading

When the answer can be checked by a program, do that. A person writes the tests once and the computer applies them forever, quickly and the same way every time.

Code and math are the classic cases. Code either passes its unit tests or it doesn't. A math answer either matches the known final answer or it doesn't.

{% include figure image_path="/assets/images/llm-evaluation/03-rule-based-checks.jpg" alt="Code checked by unit tests and a numeric answer checked against a key" caption="If a program can check it, let the program check it." %}

### Several tries: pass@k

Sometimes you can afford to let the model try several times and keep the first attempt that passes. **pass@k** is the chance that at least one of k attempts succeeds.

{% include figure image_path="/assets/images/llm-evaluation/04-pass-at-k.jpg" alt="A model makes three attempts; one passes the tests" caption="One passing attempt out of k is enough." %}

To measure it fairly, generate more attempts than you need (say n), count how many are correct (c), and use:

```
pass@k = 1 - C(n - c, k) / C(n, k)
```

In words: one minus the chance that all k attempts you pick are failures. For k = 1 this is simply c / n, the share of attempts that were correct.

The **temperature** setting matters a lot here. At zero, the model gives the same answer every time, so extra attempts add nothing. Raise it a bit and the attempts start to differ, so more of them means a better chance that one is right. Raise it too far and the answers get sloppy and the score drops again. There is a sweet spot in the middle.

{% include figure image_path="/assets/images/llm-evaluation/05-temperature.jpg" alt="A temperature dial and a curve that rises, peaks and falls" caption="Too cold: every attempt is the same. Too hot: every attempt is worse." %}

pass@k only makes sense when you can test each attempt automatically while the system runs, like running unit tests on generated code. When you can't, use **consensus@k** instead: ask k times, take the most common answer, and check that one.

{% include figure image_path="/assets/images/llm-evaluation/06-consensus.jpg" alt="Several answers to the same question; the majority answer is checked" caption="No test to run? Take a vote." %}

## Comparing words doesn't work well

For writing tasks, older metrics like **BLEU** and **METEOR** compare the model's answer with a reference answer word by word. BLEU counts matching phrases and penalizes answers that are too short. METEOR also rewards recall and penalizes answers whose matching words are scattered out of order.

The trouble is that two sentences can mean the same thing while sharing almost no words. "The car wouldn't start this morning" and "My vehicle refused to turn over at dawn" say the same thing, but a word-matching score barely connects them. These metrics also need a human-written reference for every question.

{% include figure image_path="/assets/images/llm-evaluation/07-word-overlap-limits.jpg" alt="Two sentences with the same meaning and almost no shared words" caption="Same meaning, different words, low score." %}

## Using an LLM as the judge

This is where most teams end up. You give a strong model three things: the question, the answer you want to grade, and your grading rules. It returns a verdict and a short explanation.

{% include figure image_path="/assets/images/llm-evaluation/08-llm-judge.jpg" alt="Question, answer and rules go into a judge model that returns a reason and a verdict" caption="Question, answer and rules in; reason and verdict out." %}

Why it's popular:

- **It needs no reference answer.**
- **It understands paraphrases,** so it won't fail an answer just for using different words.
- **It adapts to any task** if you change the instructions.
- **It explains itself,** which makes it much easier to debug than a bare number.

A judge prompt usually has two parts. The top describes the task and contains the inputs. The bottom says exactly what to return, for example a one or two sentence reason followed by pass or fail. Ask for the **reason first and the verdict second**: the model makes better decisions when it has to think before it decides.

### Tuning the judge so you can trust it

A judge is only useful if it agrees with people. Real grading guidelines are long and full of edge cases, so nobody writes a good judge prompt in one go. You tune it, a bit like training a model.

First, **label a small sample by hand**. Take a few dozen real answers and mark each one pass or fail yourself. This is your answer key.

{% include figure image_path="/assets/images/llm-evaluation/09-label-sample.jpg" alt="A person marking sample answers as pass or fail" caption="A small, hand-labelled answer key." %}

Next, **get a baseline**. Run your first judge prompt on the sample and compare it with your labels. Note the precision and recall, and decide what "good enough" means, for example "catches at least 90% of the bad answers".

{% include figure image_path="/assets/images/llm-evaluation/10-baseline.jpg" alt="First judge prompt scored against the labelled sample, with a target line above" caption="Know where you start and where you need to get to." %}

Then **climb**. Look at the cases the judge got wrong, work out the pattern, change the prompt and score it again. Repeat. This loop is tedious, and it's a great job to hand to a coding agent.

{% include figure image_path="/assets/images/llm-evaluation/11-hillclimb.jpg" alt="A loop of reviewing mistakes, rewriting and re-scoring, with a rising score" caption="Look at the misses, fix the prompt, score again." %}

**Stop when you hit the target.** That prompt is your judge. Without a clear target, this loop never ends.

{% include figure image_path="/assets/images/llm-evaluation/12-final-prompt.jpg" alt="The score crosses the target line and the prompt is locked" caption="Hit the target, lock the prompt, ship it." %}

### Make the judge's answer machine-readable

If you ask a model in plain words to "reply in JSON", it usually will, but there's no guarantee. Generation is random, and sooner or later one reply comes back broken.

The fix is **structured output**. You define the shape you want, say as a Python class with typed fields, and pass it to the model client's parse call. The provider then only lets the model produce tokens that fit the shape, so the reply always matches. Most major model APIs support this.

{% include figure image_path="/assets/images/llm-evaluation/13-structured-output.jpg" alt="A typed schema guides the model so only valid tokens are produced" caption="Invalid tokens are blocked, so the output always matches the schema." %}

### Watch out for the judge's bad habits

LLM judges have predictable biases:

- **First answer wins.** When comparing two answers, judges often favour whichever one comes first. Ask twice with the order swapped and combine the results.
- **Longer wins.** Judges like long answers even when the short one is better. Say in the instructions that length doesn't matter, and include an example where the short answer wins.
- **Own style wins.** A model tends to prefer text that sounds like itself. Don't use the same model as both the thing you're testing and the judge.
- **Citations win.** Judges trust answers with references, even made-up ones.

{% include figure image_path="/assets/images/llm-evaluation/14-judge-biases.jpg" alt="Three panels showing first-answer, length and own-style bias" caption="Three habits to design around." %}

A few more habits that pay off:

- **Use pass/fail instead of a 1–10 scale.** People can't agree on the difference between a 6 and a 7, and neither can models.
- **Check the judge against people** from time to time, not just once.
- **Reduce randomness.** Lower the temperature, or ask several times and take the majority.

## When an agent gets it wrong, find out where

An agent's tool call has three stages, and each one breaks in its own way:

1. **Choosing the tool and its arguments.** This is done by the model.
2. **Running the tool.** This is plain code on your backend, with no model involved.
3. **Writing the final answer** from what the tool returned. This is done by the model again.

{% include figure image_path="/assets/images/llm-evaluation/15-agent-debugging.jpg" alt="Three stages: choose the tool, run it on the backend, write the answer, each with a warning marker" caption="Find the stage first, then the fix." %}

Common failures and what usually fixes them:

| What you see | Likely cause | Fix |
| --- | --- | --- |
| Agent says "I don't know" without trying a tool | The tool router never gave it the right tool, or the description is unclear | Improve the router or the tool description |
| Agent calls a tool that doesn't exist | Weak model, confusing tool names, too much in the prompt | Stronger model, clearer names, a shorter prompt |
| Agent picks the wrong tool | Router mistake, or too many similar tools in view | Fix routing, clarify descriptions |
| Right tool, wrong arguments (like `0, 0` for a location) | The information isn't available yet | Provide it, or add a helper tool that can find it |
| Tool crashes | A bug in your backend | Return a clear error instead of crashing |
| Agent claims success when nothing happened | The tool returned nothing at all | Always return something, even `{"status": "done"}` |
| Tool returned good data but the answer ignores it | Too much output, messy output, or a weak model | Trim and structure the tool output, or use a stronger model |

That second-to-last row is worth remembering: **a tool that returns nothing invites the model to make something up.**

## Be careful with public leaderboards

Public benchmarks are useful for a rough comparison, but they have real problems.

**Models get tuned to the test.** Once a benchmark is public, its questions can leak into training data, and model makers have every reason to chase the score. When researchers make tiny, harmless changes to benchmark questions, like a different date format or different capitalization in a file name, some top-ranked models drop toward the bottom. This is **Goodhart's law**: when a measure becomes a target, it stops being a good measure.

{% include figure image_path="/assets/images/llm-evaluation/16-benchmark-gaming.jpg" alt="A top-ranked model drops after small changes to the test questions" caption="When the score is the goal, the score stops meaning much." %}

**Agents cheat when they can.** On coding benchmarks, agents have been caught reading the repository's history for the fix, or looking the answer up online. If you run agent evaluations, use fresh repositories, randomize task names, block internet access where you can, and read the logs.

**Benchmarks have bugs too.** Some tasks are ambiguous, unsolvable or have wrong expected answers. A high score on a flawed test is not worth much.

**User votes have limits.** Sites where users pick the better of two answers are slow and expensive to run, and people often prefer a confident, well-written answer even when it's wrong.

Finally, quality alone is the wrong question. Plot quality against cost, or against speed, and look at the **frontier**: the best quality you can get at each price. Often a cheaper model sits right on that line and is the better choice.

{% include figure image_path="/assets/images/llm-evaluation/17-pareto-frontier.jpg" alt="Models plotted by cost and quality with a frontier curve along the top" caption="Pick from the frontier, not just the top of the chart." %}

## How to do this in your own project

The teams that do this well build the evaluation **before** the feature. They write the grader first, then keep tweaking prompts and tools until it passes, much like test-driven development.

Organize your test cases by how much they matter:

- **P0, must pass.** About 10 critical cases. If one fails, you don't ship.
- **P1, normal use.** About 100 cases covering what the product is meant to do.
- **P2, nice to have.** About 1,000 cases for the long tail.

{% include figure image_path="/assets/images/llm-evaluation/18-eval-tiers.jpg" alt="A pyramid with a few must-pass cases on top and many nice-to-have cases at the bottom" caption="Few critical cases, more common ones, many edge cases." %}

Get cases from three places. Hand-written cases from people who know the domain are the best. Real user logs show you what people actually ask. Generated cases are the easiest to get in bulk but the lowest quality.

And whenever a check can be written as code, write it as code. An LLM judge needs calibration and adds noise. A test that compares numbers or runs the program just gives you the answer.

## The short version

- **Decide what you're measuring:** quality, reliability or real-world impact.
- **If people grade,** give them clear guidelines and check that they agree (Cohen's kappa).
- **If code can grade,** let it. Use pass@k when you can test attempts, and majority voting when you can't.
- **Don't trust word-overlap scores** for writing tasks.
- **For an LLM judge,** label a sample, get a baseline, tune the prompt to a target, use pass/fail, ask for the reason first, and design around its biases.
- **Use structured output** so judge replies are always valid.
- **Debug agents stage by stage:** choosing the tool, running it, writing the answer.
- **Treat public leaderboards with suspicion,** and compare on cost and speed as well as quality.
- **Build the evaluation first,** in P0, P1 and P2 tiers.
