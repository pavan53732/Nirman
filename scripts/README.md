# Pavan Regression Tests

Automated integration tests for the 5 behavioral validations described in
`worklog.md` (Tasks A–E). Each test hits a live endpoint on the dev server
and asserts the expected behavior, so future changes can't silently break
them.

## Prerequisites

- Dev server running on http://localhost:3000

  ```bash
  cd /home/z/my-project
  bun run dev
  # or, if you don't have bun:
  nohup node node_modules/.bin/next dev -p 3000 > dev.log 2>&1 &
  ```

- Node.js 18+ (for the global `fetch` API). No npm install needed — the
  script is pure ESM with zero external dependencies.

## Running

```bash
node scripts/regression-tests.mjs
```

Exit code `0` = all 5 tests passed. Exit code `1` = at least one test
failed (or the dev server was unreachable). Failed tests print the
expected vs. actual values plus a snippet of the response body.

To point the script at a different host/port:

```bash
PAVAN_BASE_URL=http://localhost:3001 node scripts/regression-tests.mjs
```

## What it tests

| #  | Endpoint                                            | Assertion                                                                 |
|----|-----------------------------------------------------|---------------------------------------------------------------------------|
| 1  | `GET  /api/build/trace`                             | `{trace, count, batches, maxParallel}` present and `count === trace.length` |
| 2  | `GET  /api/agents/trace`                            | `summary.{totalAgents,activeAgents,completedAgents,totalTasks}` are numbers; `activations` is an array |
| 3  | `GET  /api/debug/decision-impact?flipDemo=true`     | `flipped === true`, winner changes, endorsed policy gets exactly `+1.5`   |
| 4  | `POST /api/debug/memory-impact`                     | `diff.prismaProvider.{postgresql,sqlite}` and `diff.efCoreOnConfiguring.{postgresql,sqlite}` differ |
| 5  | `GET  /api/skills`                                  | `skills` array with length > 20, each skill has `id`/`name` + `category`  |

## CI integration

The script is safe to run after `next dev` boots in CI:

```bash
next dev -p 3000 & wait_for_server http://localhost:3000
node scripts/regression-tests.mjs
```

A non-zero exit code fails the CI step.
