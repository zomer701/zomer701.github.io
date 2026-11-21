---
title: "How an AI agent finds the right information and picks the right tool"
excerpt: "A plain-English walk through what sits around the model in a real AI agent: how it searches your documents, how you check that search works, how it chooses tools, and a few small habits that save a lot of money."
toc: true
toc_sticky: true
tags: [ai-agents, llm, rag, tool-calling, prompt-caching]
---

A language model on its own can't do much for your business. It only knows what it read during training, so it has never seen your docs, your tickets or your code. And it can't act: it can't check an order, send an email or open a file.

An AI agent fixes this by putting software around the model. That software finds the right information for each question and lets the model call tools. People call this wrapper the **harness**, and it is where most of the real engineering happens.

Here is how the pieces fit together, in the order you would build them.

## Give the agent something to read

Start by gathering the documents your agent should know about: manuals, wiki pages, support tickets, code. If it isn't in this pile, the agent can't use it.

{% include figure image_path="/assets/images/ai-agents/01-collect-documents.jpg" alt="Documents from several sources collected into one place" caption="Everything the agent should know starts here." %}

Whole documents are too big to work with, so you cut them into smaller pieces called **chunks**. Let neighbouring chunks overlap a little. Otherwise a sentence that falls on a boundary gets cut in half and neither piece makes sense.

{% include figure image_path="/assets/images/ai-agents/02-chunk-documents.jpg" alt="A pile of documents cut into overlapping text chunks" caption="Small pieces with a bit of overlap, so no sentence gets cut in half." %}

Then you turn each chunk into a list of numbers, called an **embedding**. Chunks that mean similar things get similar numbers, which is what makes search by meaning possible.

{% include figure image_path="/assets/images/ai-agents/03-embed-chunks.jpg" alt="Text chunks turned into vectors by an encoder" caption="Each chunk becomes a vector the computer can compare." %}

## Search in two passes

When a question comes in, the agent searches in two passes, a quick one and a careful one.

The **first pass** is quick and generous. It grabs everything that might be relevant. A few wrong chunks are fine at this stage. Missing the right one is not.

{% include figure image_path="/assets/images/ai-agents/04-candidate-retrieval.jpg" alt="A large list of candidate chunks pulled from the knowledge base" caption="The first pass casts a wide net." %}

The **second pass** is slow and careful. A stronger model looks at each candidate again and keeps only the best few. Those few are what the agent actually reads before it answers.

{% include figure image_path="/assets/images/ai-agents/05-re-rank-top-k.jpg" alt="Candidates re-ranked and the best few selected" caption="The second pass keeps only the best few." %}

Why two passes? The careful model is too slow to read millions of chunks, and the quick one is too rough to pick the final answer. So each does the part it's good at.

### How the quick pass works

The quick pass is fast because most of the work happens before anyone asks anything. You turn every chunk into an embedding once, ahead of time, and store them all, often in a vector database.

{% include figure image_path="/assets/images/ai-agents/07-precompute-embeddings.jpg" alt="Chunks encoded and stored in a vector database" caption="Done once, in advance." %}

When a question arrives, you turn it into an embedding with the same model, so the question and the chunks are directly comparable.

{% include figure image_path="/assets/images/ai-agents/08-embed-query.jpg" alt="A user's question turned into a vector" caption="The question gets the same treatment as the documents." %}

Then you look for the chunks whose numbers are closest to the question's. Comparing against every chunk would take too long, so you use an approximate nearest-neighbour search. It's a shortcut that is almost always right and much faster.

{% include figure image_path="/assets/images/ai-agents/09-nearest-neighbor-search.jpg" alt="The question compared with chunks, each getting a similarity score" caption="Every chunk gets a similarity score." %}

You keep the top hundred or so and hand them to the careful pass.

{% include figure image_path="/assets/images/ai-agents/06-select-top-candidates.jpg" alt="Many chunks filtered down to a small high-scoring set" caption="About a hundred candidates move on." %}

### How the careful pass works

The careful pass reads the question and a chunk **together**, as one piece of text, so every word of the question can be checked against every word of the chunk. That is why it is more accurate, and also why it can't be prepared in advance.

{% include figure image_path="/assets/images/ai-agents/10-format-query-chunk.jpg" alt="A question and a chunk joined into one input" caption="Question and chunk go in side by side." %}

The model reads the pair and gives back a single score between 0 and 1: how well this chunk answers this question. This kind of model is called a **cross-encoder**.

{% include figure image_path="/assets/images/ai-agents/11-cross-encoder-score.jpg" alt="A question and chunk scored 0.85 by a cross-encoder" caption="One score per pair." %}

Sort the candidates by that score and keep the top few. That's your final search result.

{% include figure image_path="/assets/images/ai-agents/12-sort-by-relevance.jpg" alt="Candidates sorted by score into a final ranking" caption="Highest score first." %}

## Check that search actually works

If search returns the wrong chunks, the agent gives wrong answers, no matter how good the model is. So measure it.

First, write down a set of real questions and mark which chunks *should* come back for each. This answer key is the most useful thing you'll build, because every later change gets judged against it.

{% include figure image_path="/assets/images/ai-agents/13-label-eval-set.jpg" alt="Questions and chunks marked relevant or not relevant" caption="An answer key: for each question, the chunks that should come back." %}

Then run your search on every question and save what it returns.

{% include figure image_path="/assets/images/ai-agents/14-run-retrieval.jpg" alt="Questions run through the search system, each returning a ranked list" caption="Run every question and save the results." %}

Then compare the results with the answer key. Four common scores tell you different things:

- **Recall** asks whether the right chunks showed up at all.
- **Precision** asks how much of what showed up was actually useful.
- **Reciprocal rank** asks how high up the first good chunk was.
- **NDCG** asks whether the good chunks were near the top, where they matter most.

{% include figure image_path="/assets/images/ai-agents/15-retrieval-metrics.jpg" alt="Search results compared with the answer key and scored four ways" caption="Track these numbers the way you track test results." %}

## Write tool descriptions the model understands

When you give a model a tool, all it sees is the tool's name and a short description. From that text alone it decides whether to use the tool and how. A vague description leads to wrong calls, so test descriptions the same way you test search.

Collect questions people really ask, each with the answer you'd expect.

{% include figure image_path="/assets/images/ai-agents/16-tool-eval-set.jpg" alt="A table of questions and expected answers" caption="Real questions, each with the answer you'd expect." %}

Run the agent on those questions with the descriptions you have now, and save what it actually answers.

{% include figure image_path="/assets/images/ai-agents/17-run-tool-llm.jpg" alt="Questions and tool descriptions fed to the agent, producing answers" caption="Your starting point: what the agent does today." %}

Then give a reasoning model three things: the expected answers, the actual answers and the current descriptions. Ask it to rewrite the descriptions so the agent gets closer. Run the test again and repeat until the answers match.

{% include figure image_path="/assets/images/ai-agents/18-optimize-tool-descriptions.jpg" alt="A loop that compares answers and rewrites tool descriptions" caption="Run, compare, rewrite, repeat." %}

## Don't hand the model every tool

Each tool you add takes up room in the prompt, slows the model down and gives it one more way to pick wrong. Once you have dozens of tools, filter them first.

A small, cheap model can act as a **router**. It looks at the question, the conversation so far and what it knows about the user, and picks the handful of tools that make sense.

{% include figure image_path="/assets/images/ai-agents/19-tool-router.jpg" alt="A large set of tools narrowed by a router to a few" caption="A cheap router saves the expensive model a lot of work." %}

Only those tools go into the main model's prompt, next to the user's question.

{% include figure image_path="/assets/images/ai-agents/20-fill-context-window.jpg" alt="Selected tools and the user's question placed into the model's context" caption="The main model only sees tools that fit the request." %}

## Put the parts that never change first

Most model providers cache the start of your prompt. If the beginning is exactly the same as last time, they reuse earlier work, and you pay less and wait less.

So put everything that never changes at the top: your instructions and your tool descriptions. Put the parts that change with every request at the bottom: information about the user, then their question.

{% include figure image_path="/assets/images/ai-agents/21-cache-friendly-prompt.jpg" alt="Prompts with a fixed start hit the cache; reordered prompts miss it" caption="Same start every time means a cache hit. Shuffle it and you pay full price." %}

Be careful with small things like the current time or the user's name. Put one near the top and the start of the prompt is different on every request, so the cache never kicks in.

## Let the agent save what it learned

Here's a nice trick for coding agents. After the agent finishes a task from start to finish, ask it to write down how it did it as a **skill**: a folder with instructions and any scripts it needed. Next time a similar task comes up, it follows the recipe instead of figuring everything out again.

{% include figure image_path="/assets/images/ai-agents/22-task-to-skill.jpg" alt="A finished task turned into a skill folder with instructions and scripts" caption="Finished work becomes a recipe for next time." %}

## The short version

- **Cut your documents into overlapping chunks** and turn each into an embedding.
- **Search in two passes:** a quick one that grabs a lot, then a careful one that keeps the best.
- **Keep an answer key** and score your search against it every time you change something.
- **Test tool descriptions** with real questions, and let a reasoning model improve them.
- **Use a small router** so the main model only sees the tools it needs.
- **Put fixed text at the top of the prompt** so caching works.
- **Have the agent turn finished work into skills** it can reuse.
