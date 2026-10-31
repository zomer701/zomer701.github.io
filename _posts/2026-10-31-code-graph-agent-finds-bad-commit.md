---
title: "A code graph and a looping agent that find the bad commit in minutes"
excerpt: "An alert fires. Instead of reading git log for half an hour, a small Java agent reads the stack trace, walks a call graph built from your compiled classes, and ranks the deploys by how close they touched the failing code. If nothing is close, it loops and looks further back."
toc: true
toc_sticky: true
tags: [java, monitoring, agents, archunit, langgraph]
---

An alert fires at noon. `IllegalStateException` in `PaymentClient.charge`, 500s on checkout. The first question is always the same: **what changed?**

The usual answer is someone scrolling `git log` and the deploy history, opening diffs one by one, and guessing which change could reach the failing code. That takes half an hour on a good day.

Most of that work is mechanical, so I gave it to code:

1. **A code graph.** Read the compiled classes and build a method-level call graph.
2. **A ranker.** Take the methods from the stack trace, walk the graph, and score every recent deploy by how many hops its changed methods are from the failure.
3. **A looping agent.** A small LangGraph-style state graph: fetch errors → extract frames → rank → *close enough?* If not, widen the time window and **go round again**.

The rule that holds it together: **the graph decides, the LLM only explains.** Edges, distances and commit ranges come from deterministic code. A model can write the summary, but it never invents a suspect.

Everything below is plain Java 21 and compiles. The only dependency is [ArchUnit](https://www.archunit.org/), for reading bytecode.

## The shape of it

```text
            ┌──────────────┐
  alert ──► │ fetch_errors │ ◄──────────────┐
            └──────┬───────┘                │
                   ▼                        │
           ┌────────────────┐               │
           │ extract_frames │               │
           └───────┬────────┘               │
                   ▼                        │
           ┌──────────────┐  nothing close  ┌──────────────┐
           │ rank_commits │ ──────────────► │ widen_window │  (window × 2, max 3 loops)
           └──────┬───────┘                 └──────────────┘
                  │ suspect ≤ 2 hops away
                  ▼
             ┌─────────┐
             │ explain │ ──► END
             └─────────┘
```

That loop is the reason for a graph instead of a straight pipeline. A pipeline looks at one time window and gives up. The bad deploy is often older than the alert window: it went out at 10:20, and traffic only reached the broken path at 11:50. The cycle keeps searching until it finds something close, and the loop limit makes sure it stops.

## Step 1: a call graph from compiled classes

Why bytecode and not source? Because the code that actually runs isn't all in your `.java` files. Lombok getters, MapStruct mappers, OpenAPI-generated interfaces and lambdas only exist after compilation. ArchUnit's `ClassFileImporter` reads `.class` files without loading them, and every method gives you the calls it makes.

Each node is named `package.Class.method`. That's deliberate: it's exactly the form a stack frame has, so a frame from your logs is already a node id.

```java
package triage;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Method-level call graph read from compiled classes. Node id = "pkg.Class.method", the form a stack frame has. */
public final class CodeGraph {
  private final Map<String, Set<String>> neighbours = new HashMap<>();


  public static CodeGraph fromClasses(Path classesDir, String basePackage) {
    var graph = new CodeGraph();
    var classes = new ClassFileImporter().importPath(classesDir);

    for (var javaClass : classes) {
      for (var codeUnit : javaClass.getCodeUnits()) {
        var from = javaClass.getName() + "." + codeUnit.getName();

        for (var call : codeUnit.getCallsFromSelf()) {
          var target = call.getTarget();
          if (target.getOwner().getPackageName().startsWith(basePackage)) {
            graph.addEdge(from, target.getOwner().getName() + "." + target.getName());
          }
        }
      }
    }
    return graph;
  }

  public void addEdge(String caller, String callee) {
    // Undirected on purpose: a bad change can sit above the failing frame (caller) or below it (callee).
    neighbours.computeIfAbsent(caller, k -> new HashSet<>()).add(callee);
    neighbours.computeIfAbsent(callee, k -> new HashSet<>()).add(caller);
  }

  /** Multi-source BFS: hops from the nearest failing frame to every method within maxDepth. */
  public Map<String, Integer> distancesFrom(Set<String> frames, int maxDepth) {
    var distance = new HashMap<String, Integer>();
    var queue = new ArrayDeque<String>();
    for (var frame : frames) {
      distance.put(frame, 0);
      queue.add(frame);
    }

    while (!queue.isEmpty()) {
      var node = queue.poll();
      var next = distance.get(node) + 1;
      if (next > maxDepth) {
        continue;
      }
      for (var neighbour : neighbours.getOrDefault(node, Set.of())) {
        if (distance.putIfAbsent(neighbour, next) == null) {
          queue.add(neighbour);
        }
      }
    }
    return distance;
  }

  public int size() {
    return neighbours.size();
  }
}
```

Two choices worth explaining:

- **Undirected edges.** The bad change can sit *below* the failing frame (a helper it calls now returns garbage) or *above* it (a caller now passes garbage in). Walking both directions catches both.
- **Multi-source BFS.** Every frame in the stack trace starts at distance 0, so the result is "hops to the nearest frame" in one pass.

In a real Spring service you'll want a few more edge types than plain calls. The most important one is interface → implementation, because almost every service call in Spring goes through an interface or a proxy. Without it, the graph has gaps exactly where the beans connect. Start with calls and add edge types when a real incident shows a gap.

## Step 2: rank deploys by distance

A commit is a set of changed methods. In production you get them from `git diff base..head`, mapping each changed line range to the method that contains it (JavaParser gives you method line ranges). Here the commit simply carries them:

```java
package triage;

import java.time.Instant;
import java.util.Set;

public record Commit(String sha, String title, Instant deployedAt, Set<String> changedMethods) {}

package triage;

public record Suspect(Commit commit, String method, int distance) {}
```

```java
package triage;

import java.util.Comparator;
import java.util.List;
import java.util.Set;

/** Ranks commits by how close their changed methods sit to the failing frames. Deterministic, no LLM. */
public final class SuspectRanker {
  private static final int MAX_DEPTH = 6;

  private final CodeGraph graph;


  public SuspectRanker(CodeGraph graph) {
    this.graph = graph;
  }

  public List<Suspect> rank(Set<String> frames, List<Commit> commits) {
    var distances = graph.distancesFrom(frames, MAX_DEPTH);

    return commits.stream()
        .flatMap(commit -> commit.changedMethods().stream()
            .filter(distances::containsKey)
            .map(method -> new Suspect(commit, method, distances.get(method))))
        .sorted(Comparator.comparingInt(Suspect::distance))
        .toList();
  }
}
```

A change that the graph can't reach within 6 hops doesn't make the list at all. That's what you want: the receipt-email tweak deployed 15 minutes ago is the most *recent* change, but it can't touch checkout, so it shouldn't waste anyone's time.

Notice the word in the output later: **potential**. Graph distance says a change *could* reach the failure, not that it *caused* it. "No deployed change is near the failing code" is also a valid answer. It points you at data, config or a dependency instead.

## Step 3: a LangGraph-style state graph in 50 lines

[LangGraph](https://langchain-ai.github.io/langgraph/) (and its Java port, LangGraph4j) models an agent as **nodes** that transform a shared state and **edges** that pick the next node. Conditional edges let the graph branch and loop. That model fits triage well, and the core is small enough to write yourself:

```java
package triage;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.function.UnaryOperator;

/** A LangGraph-style state machine: nodes transform the state, edges (fixed or conditional) pick the next node. */
public final class StateGraph<S> {
  public static final String END = "__end__";

  private final Map<String, UnaryOperator<S>> nodes = new HashMap<>();
  private final Map<String, Function<S, String>> edges = new HashMap<>();
  private String entryPoint;


  public StateGraph<S> addNode(String name, UnaryOperator<S> action) {
    nodes.put(name, action);
    return this;
  }

  public StateGraph<S> addEdge(String from, String to) {
    edges.put(from, state -> to);
    return this;
  }

  public StateGraph<S> addConditionalEdge(String from, Function<S, String> router) {
    edges.put(from, router);
    return this;
  }

  public StateGraph<S> setEntryPoint(String name) {
    entryPoint = name;
    return this;
  }

  public S run(S initial, int maxSteps) {
    var state = initial;
    var current = entryPoint;

    for (var step = 0; step < maxSteps; step++) {
      if (END.equals(current)) {
        return state;
      }
      System.out.println("  -> " + current);
      state = nodes.get(current).apply(state);
      current = edges.get(current).apply(state);
    }
    throw new StepLimitExceededException(maxSteps);
  }
}
```

`maxSteps` is the safety net. Any graph with a cycle needs a hard stop that doesn't depend on the routing logic being right.

The state is an immutable record. Each node returns a new copy, so you can log every step and replay a run:

```java
package triage;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

public record TriageState(
    Instant alertAt,
    Duration window,
    int loops,
    List<ErrorEvent> errors,
    Set<String> frames,
    List<Suspect> suspects,
    String brief) {

  public static TriageState start(Instant alertAt, Duration window) {
    return new TriageState(alertAt, window, 0, List.of(), Set.of(), List.of(), "");
  }

  public Instant from() {
    return alertAt.minus(window);
  }

  public TriageState withErrors(List<ErrorEvent> value) {
    return new TriageState(alertAt, window, loops, value, frames, suspects, brief);
  }

  public TriageState withFrames(Set<String> value) {
    return new TriageState(alertAt, window, loops, errors, value, suspects, brief);
  }

  public TriageState withSuspects(List<Suspect> value) {
    return new TriageState(alertAt, window, loops, errors, frames, value, brief);
  }

  public TriageState widened() {
    return new TriageState(alertAt, window.multipliedBy(2), loops + 1, errors, frames, suspects, brief);
  }

  public TriageState withBrief(String value) {
    return new TriageState(alertAt, window, loops, errors, frames, suspects, value);
  }
}
```

## Step 4: wire the triage agent

The agent reads from one interface. Behind it goes whatever you run: Elasticsearch or Loki for errors, git plus your deploy records for commits.

```java
package triage;

import java.time.Instant;
import java.util.List;

/** What the agent reads. Back it with Elasticsearch, Loki, Datadog, git log + your deploy records. */
public interface Monitoring {
  List<ErrorEvent> errorsBetween(Instant from, Instant to);

  List<Commit> deploysBetween(Instant from, Instant to);
}
```

```java
package triage;

import static java.util.stream.Collectors.toSet;

import java.util.Set;
import java.util.function.UnaryOperator;

public final class TriageAgent {
  private static final int CLOSE_ENOUGH = 2;
  private static final int MAX_LOOPS = 3;

  private final Monitoring monitoring;
  private final SuspectRanker ranker;
  private final String basePackage;
  private final StateGraph<TriageState> graph;


  public TriageAgent(
      Monitoring monitoring,
      SuspectRanker ranker,
      String basePackage,
      UnaryOperator<TriageState> explain) {
    this.monitoring = monitoring;
    this.ranker = ranker;
    this.basePackage = basePackage;
    this.graph = new StateGraph<TriageState>()
        .addNode("fetch_errors", this::fetchErrors)
        .addNode("extract_frames", this::extractFrames)
        .addNode("rank_commits", this::rankCommits)
        .addNode("widen_window", TriageState::widened)
        .addNode("explain", explain)
        .setEntryPoint("fetch_errors")
        .addEdge("fetch_errors", "extract_frames")
        .addEdge("extract_frames", "rank_commits")
        .addConditionalEdge("rank_commits", TriageAgent::route)
        .addEdge("widen_window", "fetch_errors") // the cycle
        .addEdge("explain", StateGraph.END);
  }

  public TriageState run(TriageState initial) {
    return graph.run(initial, 25);
  }

  private TriageState fetchErrors(TriageState s) {
    return s.withErrors(monitoring.errorsBetween(s.from(), s.alertAt()));
  }

  private TriageState extractFrames(TriageState s) {
    Set<String> frames = s.errors().stream()
        .flatMap(e -> e.stackFrames().stream())
        .filter(frame -> frame.startsWith(basePackage))
        .map(frame -> frame.replaceAll("lambda\\$(\\w+)\\$\\d+$", "$1"))
        .collect(toSet());
    return s.withFrames(frames);
  }

  private TriageState rankCommits(TriageState s) {
    var deploys = monitoring.deploysBetween(s.from(), s.alertAt());
    return s.withSuspects(ranker.rank(s.frames(), deploys));
  }

  private static String route(TriageState s) {
    var hasCloseSuspect = !s.suspects().isEmpty() && s.suspects().getFirst().distance() <= CLOSE_ENOUGH;
    if (hasCloseSuspect || s.loops() >= MAX_LOOPS) {
      return "explain";
    }
    return "widen_window";
  }
}
```

The router is the whole "agent decision": stop when the best suspect is within 2 hops, or after 3 loops. Otherwise double the window and go back to `fetch_errors`. Re-fetching errors on every loop matters, because a wider window can show an earlier, smaller wave of the same error. That wave can bring new frames into the graph search.

`extract_frames` drops framework frames (`org.springframework...`) and turns `lambda$placeOrder$0` back into `placeOrder`, so lambdas land on the method that owns them.

## Run it

A tiny sample app: `OrderController → OrderService → PaymentClient`, with `PriceCalculator → Discounts` feeding the amount, and an `EmailService` that nothing on that path calls.

Two deploys before the alert:

| Commit | Deployed | Changed |
| --- | --- | --- |
| `a1f3` Tweak receipt email | 15 min before | `EmailService.sendReceipt` |
| `b7c2` New loyalty discount | 100 min before | `Discounts.apply` |

The new discount takes 100 cents off every order, so the cheapest cart now totals zero, and `PaymentClient.charge` throws. The demo (a fake `Monitoring` with those two deploys and one error) is in the code at the end of the post.

```bash
javac -d out/shop shop/src/shop/*.java
javac -cp archunit-1.5.1.jar:slf4j-api-2.0.19.jar -d out/triage src/triage/*.java
java  -cp archunit-1.5.1.jar:slf4j-api-2.0.19.jar:out/triage triage.TriageDemo out/shop
```

```text
graph: 10 methods
  -> fetch_errors
  -> extract_frames
  -> rank_commits
  -> widen_window
  -> fetch_errors
  -> extract_frames
  -> rank_commits
  -> widen_window
  -> fetch_errors
  -> extract_frames
  -> rank_commits
  -> explain
Window: 120 min, loops: 2, errors: 1
Top suspect (potential, not proven): b7c2 "New loyalty discount"
  changed shop.Discounts.apply, 2 hop(s) from the failing frames
```

Here's what happened:

- **30 min:** only the email commit is in range. The graph can't reach it from the stack trace, so there are no suspects. Widen.
- **60 min:** still nothing. Widen.
- **120 min:** `b7c2` is in range. `Discounts.apply → PriceCalculator.total → OrderService.placeOrder` is 2 hops from a failing frame. Close enough. Explain.

The most recent deploy was a red herring, and the agent skipped it without anyone opening a diff.

## Where the LLM goes

Only in `explain`. In the demo it's a text block. In real use you hand the model the finished state: the error, the frames, the ranked suspects with their paths, the window and the loop count. Ask it to write the brief for the on-call engineer.

```java
// Swap this for an LLM call. It gets facts, it does not pick them.
private static TriageState explain(TriageState s) { ... }
```

Keep it on that side of the line. If the model chooses which commits to look at, you get a confident story about the wrong commit. When the graph chooses, the worst case is an honest "nothing close".

## What to add for a real service

- **Interface and proxy edges.** Interface → implementation, `@EventListener` / queue consumers → publishers. Mark guesses as *potential* edges so they rank below confirmed calls.
- **Build the graph in CI.** Run it once per commit SHA right after `compile` and keep it with the build. When an alert fires, load the graph for the version that's actually running, never one built from `main`.
- **Put the version in every log line.** Without `service.version` on the error, you can't tell which deploy range to rank.
- **Cap everything.** Frames per query, commits per window, loops, total steps. Triage happens during an incident, so it has to answer fast.

## Full demo code

<details markdown="1">
<summary>TriageDemo.java (fake monitoring + explain)</summary>

```java
package triage;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

public class TriageDemo {
  public static void main(String[] args) {
    var alertAt = Instant.parse("2026-10-31T12:00:00Z");

    var graph = CodeGraph.fromClasses(Path.of(args[0]), "shop");
    System.out.println("graph: " + graph.size() + " methods");

    var monitoring = new FakeMonitoring(alertAt);
    var agent = new TriageAgent(monitoring, new SuspectRanker(graph), "shop.", TriageDemo::explain);

    var result = agent.run(TriageState.start(alertAt, Duration.ofMinutes(30)));
    System.out.println(result.brief());
  }

  // Swap this for an LLM call. It gets facts, it does not pick them.
  private static TriageState explain(TriageState s) {
    if (s.suspects().isEmpty()) {
      return s.withBrief("No deployed change near the failing code in the last " + s.window().toMinutes() + " min.");
    }
    var top = s.suspects().getFirst();
    return s.withBrief("""
        Window: %d min, loops: %d, errors: %d
        Top suspect (potential, not proven): %s "%s"
          changed %s, %d hop(s) from the failing frames
        """.formatted(
            s.window().toMinutes(), s.loops(), s.errors().size(),
            top.commit().sha(), top.commit().title(), top.method(), top.distance()));
  }

  record FakeMonitoring(Instant alertAt) implements Monitoring {
    @Override
    public List<ErrorEvent> errorsBetween(Instant from, Instant to) {
      var error = new ErrorEvent(
          alertAt.minus(Duration.ofMinutes(10)),
          "IllegalStateException@PaymentClient.charge",
          List.of(
              "shop.PaymentClient.charge",
              "shop.OrderService.placeOrder",
              "shop.OrderController.checkout",
              "org.springframework.web.servlet.DispatcherServlet.doDispatch"));
      return error.at().isAfter(from) ? List.of(error) : List.of();
    }

    @Override
    public List<Commit> deploysBetween(Instant from, Instant to) {
      var all = List.of(
          new Commit("a1f3", "Tweak receipt email", alertAt.minus(Duration.ofMinutes(15)),
              Set.of("shop.EmailService.sendReceipt")),
          new Commit("b7c2", "New loyalty discount", alertAt.minus(Duration.ofMinutes(100)),
              Set.of("shop.Discounts.apply")));
      return all.stream().filter(c -> c.deployedAt().isAfter(from)).toList();
    }
  }
}
```

</details>

<details markdown="1">
<summary>Sample app (shop package)</summary>

```java
package shop;

public class OrderController {
  private final OrderService orders = new OrderService();

  public String checkout(String cartId) {
    return orders.placeOrder(cartId);
  }
}

package shop;

public class OrderService {
  private final PaymentClient payments = new PaymentClient();
  private final InventoryService inventory = new InventoryService();

  public String placeOrder(String cartId) {
    inventory.reserve(cartId);
    return payments.charge(cartId, PriceCalculator.total(cartId));
  }
}

package shop;

public class PaymentClient {
  public String charge(String cartId, long cents) {
    if (cents <= 0) {
      throw new IllegalStateException("bad amount for " + cartId);
    }
    return "paid";
  }
}

package shop;

public class PriceCalculator {
  public static long total(String cartId) {
    return Discounts.apply(cartId.length() * 100L);
  }
}

package shop;

public class Discounts {
  public static long apply(long cents) {
    return cents - 100;
  }
}

package shop;

public class InventoryService {
  public void reserve(String cartId) {}
}

package shop;

public class EmailService {
  public void sendReceipt(String cartId) {}
}

```

</details>
