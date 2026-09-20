# Incremental formula calculation

`createEvaluator` now supports two mutation contracts. Both use the same safe formula parser and preserve the existing callable evaluator API.

## Host-managed cell edits

```js
const evaluate = createEvaluator(workbook, { managedMutations: true, revision: 0 });

// Apply the complete batch, then notify before reading any calculated value.
sheet.cells.A1 = { value: 120 };
delete sheet.cells.A2;
evaluate.invalidateCells(sheet.id, ['A1', 'A2'], 1);
const result = evaluate(sheet, 'B1');
```

Use this mode only when the host reports every cell **value** change, including undo/redo, deletes, paste, formula replacement, and imports that mutate an existing workbook. Style-only changes do not affect formula values. For a batch spanning multiple sheets, apply all changes and call `invalidateCells` for each sheet before evaluating. Cell keys are case-insensitive and may include `$`; duplicate keys are deduplicated.

`invalidateCells(sheetId, keys, revision?)` removes the changed formulas and their transitive dependents from the cache. It preserves independent cached formulas. Recalculation is lazy: invalidation does not execute formulas; a later read evaluates only the invalidated formulas it needs. A valid cached result is returned without recursively reading or validating dependencies.

The optional revision is exposed as `evaluate.revision` for host coordination. Changing it via `invalidateCells` does not clear unrelated results. The host owns its monotonic revision convention.

## Default mutable-workbook mode

Without `managedMutations: true`, reads validate the values and typed errors of previously read dependencies, so ordinary direct mutations to `sheet.cells` remain observable without explicit notification. This mode retains more dependency snapshots and traverses dependencies on cache hits. Hosts may still call `invalidateCells` in this mode.

Changing sheet identities/names, inserting or removing sheets, replacing the workbook graph, or making unknown external mutations requires `evaluate.invalidate(revision?)` or a new evaluator. This includes repairing a previously missing sheet reference. `invalidate` clears results and dependency subscriptions, while retaining parsed formula syntax. `TODAY` is cached like other formulas; call `invalidate` when the local date changes if an evaluator remains alive overnight.

## Dependency storage

Each evaluated formula records its direct cell reads, including blank cells and typed calculation errors. A reverse cell graph drives transitive invalidation across sheets. Conditional branches record the inputs actually read; recomputing an `IF` replaces its previous branch subscriptions. Replacing a formula with a value or deleting it removes its outgoing subscriptions after invalidation.

A range is stored as a rectangle subscription on its source sheet. In managed mode, reading a 100,000-cell range does **not** create 100,000 reverse dependency edges or retained member snapshots. A change to any member—including a previously blank member or a formula whose value changes transitively—invalidates the consuming formula. Each range remains subject to the existing 100,000-cell evaluation limit.

Range membership lookup uses a dynamic AVL rectangle index on each source sheet. Each rectangle occupies one tree node, keyed by its first row/column; each node stores the two-dimensional bounding box of its entire subtree. Point queries skip subtrees whose bounding boxes do not contain the edited cell. Insertions and removals rebalance the tree in O(log n), and removing a formula releases all of its rectangle entries. Empty sheet indexes are dropped; full invalidation drops every index. Coordinate span does not affect memory usage: even a rectangle covering a million rows takes one node.

Point queries are **not** guaranteed O(log n): dense overlap or loose bounding boxes can require visiting many nodes, and returning n matching owners necessarily costs O(n). The work counters include candidate rectangle checks and all visited tree nodes so pruning is measurable without hiding this worst case. Range evaluation still visits its cells and builds the function's input matrix. This is an invalidation index, not a sparse aggregate index or a promise of constant-time large-range calculation.

Parsed expression syntax is retained separately from calculated results and is capped at **4,096 expressions per evaluator**, with oldest-inserted (FIFO) eviction. Repeatedly editing one cell therefore cannot grow the syntax cache without bound. Reusing an evicted formula reparses it normally; eviction never changes dependency tracking or calculated values. Full result invalidation and counter resets retain this bounded syntax cache. Formula text and nesting retain their existing parser limits.

Normal formula errors and cyclic references are cached with their dependency graph, so repairing an input invalidates the error. Error values are distinct from literal strings such as `"#DIV/0!"`; `IFERROR` therefore remains correct. Stack-depth-limit failures are not cached because they depend on the root formula and active recursion depth.

## Evidence and counters

`evaluate.stats` returns a detached read-only snapshot:

| Field                   | Meaning                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `formulaEvaluations`    | Formula bodies actually executed since the last counter reset                |
| `cacheHits`             | Cached formula results returned, including cached errors                     |
| `dependencyChecks`      | Individual dependency validations in default mutation mode                   |
| `invalidatedEntries`    | Cached results removed by explicit cell/full invalidation                    |
| `cacheEntries`          | Current retained formula results                                             |
| `directDependencyEdges` | Current reverse direct-cell subscriptions                                    |
| `rangeDependencyEdges`  | Current retained rectangle subscriptions                                     |
| `rangeCandidateChecks`  | Rectangle containment checks during invalidation queries since reset         |
| `rangeNodeVisits`       | All visited index nodes, including subtrees rejected by their bounding boxes |
| `rangeIndexNodes`       | Current retained tree nodes; exactly one per rectangle subscription          |
| `parsedExpressions`     | Current retained formula syntax trees, capped at 4,096                       |

`evaluate.resetStats()` resets activity counters while retaining the cache and dependency graph. These are counts of real engine work, not estimates of rendered FPS or fabricated timing results.

`tests/engine-incremental.test.ts` verifies:

- 2,000 independent cached formulas retain 1,999 entries when one input changes, then execute only one formula body.
- A cache hit in managed mode has zero dependency checks.
- A 100,000-member range retains one rectangle subscription, and an initially blank member edit invalidates it.
- 10,000 disjoint range formulas retain 9,999 cache entries after one input edit, with fewer than 32 candidate rectangle checks and 64 tree-node visits, including transitive point queries.
- Cross-sheet range changes invalidate transitive formulas; changing an `IF` branch or replacing its formula releases obsolete index nodes and empty source-sheet indexes.
- More than 5,000 distinct formula edits in one cell retain at most 4,096 parsed expressions; reusing an evicted expression still computes correctly.
- Cross-sheet/transitive dependencies, changed range members containing formulas, dynamic `IF` branches, deletes, replacements, typed errors, cycle repair, duplicate notifications, full resets, and compatibility with unannounced ordinary edits in default mode.

`tests/range-dependency-index.test.ts` separately checks 2,500 deterministic randomized insertion/removal operations against a brute-force query oracle, inclusive boundaries, million-row spans, owner deletion, stale handles, malformed rectangles, row/column-disjoint sets of 10,000 rectangles, and dense overlap. Its 1,001 overlapping rectangles report 1,001 candidate checks; no sublinear claim is made for that case.

This is synchronous formula evaluation. Worker scheduling, workbook transfer protocols, and UI rendering metrics are separate from this cache contract.
