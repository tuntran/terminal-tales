// A Bash command counts as a test run when one of its simple commands
// invokes a known test runner. Text inside quotes or a heredoc body is never a
// command, so `echo "npm test"` and a commit message that mentions tests do
// not count.

const PM = '(npm|pnpm|yarn|bun)'
const PM_SCOPE = '( (-r|--recursive|-w|--workspace-root|--filter[ =]\\S+|-F \\S+|workspace \\S+))*'

const RUNNERS: readonly RegExp[] = [
  new RegExp(`^${PM}${PM_SCOPE}( run)? (test|t)(\\b|:)`),
  /^(npx |pnpm (exec |dlx )?|yarn |bunx |bun x )?(vitest|jest|mocha|ava|playwright test|cypress run|turbo( run)? test|nx( run-many -t| run \S+:)? ?test)\b/,
  /^node --test\b/,
  /^(python3? -m )?(pytest|py\.test)\b/,
  /^python3? -m unittest\b/,
  /^(uv run|poetry run|pipenv run|hatch run) (pytest|py\.test|python3? -m pytest)\b/,
  /^(tox|nox)\b/,
  /^go test\b/,
  /^cargo (test|nextest)\b/,
  /^(mix|deno|swift|dotnet|flutter|dart|bazel|bazelisk|zig build) test\b/,
  /^ctest\b/,
  /^(\.\/)?(gradlew|mvnw|gradle|mvn)( \S+)* test\b/,
  /^(bundle exec )?(rspec|rake test|rails test)\b/,
  /^(php artisan test|(vendor\/bin\/)?phpunit|(vendor\/bin\/)?pest)\b/,
  /^make (test|check)\b/,
  /^claude plugin test\b/,
]

// Runs that exit 0 without executing a single test.
const NO_RUN = /\s(--collect-only|--co|--no-run|--listTests|--list-tests|--list|--help|-h|--version)(\s|=|$)|^go test\b.*\s-run[ =]['"]?(NONE|\^\$)/

// Words that wrap a command without changing what runs.
const WRAPPER = /^(!|if|then|else|elif|do|while|until|time|exec|command|nice|caffeinate|xvfb-run|env( -\S+)*|timeout( -\S+)* \S+|\w+=\S*)\s+/

/** Splits a shell line into simple commands, leaving quoted text and heredoc bodies out. */
export function simpleCommands(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  let heredoc: string | null = null
  const lines = line.split('\n')
  for (let n = 0; n < lines.length; n += 1) {
    const text = lines[n]!
    if (heredoc !== null) {
      if (text.trim() === heredoc) heredoc = null
      continue
    }
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]!
      if (quote !== null) {
        if (ch === '\\' && quote === '"') i += 1
        else if (ch === quote) quote = null
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
        current += ' '
        continue
      }
      if (ch === '\\') {
        i += 1
        continue
      }
      const here = /^<<-?\s*['"]?(\w+)['"]?/.exec(text.slice(i))
      if (here) {
        heredoc = here[1]!
        i += here[0].length - 1
        continue
      }
      if (ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === ')' || ch === '{' || ch === '}') {
        out.push(current)
        current = ''
        continue
      }
      current += ch
    }
    if (quote === null) {
      out.push(current)
      current = ''
    }
  }
  out.push(current)
  return out.map(cleanCommand).filter(command => command.length > 0)
}

function cleanCommand(command: string): string {
  let rest = command.replace(/\s+/g, ' ').trim()
  for (let previous = ''; previous !== rest; ) {
    previous = rest
    rest = rest.replace(WRAPPER, '')
  }
  return rest
}

export function isTestCommand(command: string): boolean {
  return simpleCommands(command).some(segment => !NO_RUN.test(segment) && RUNNERS.some(runner => runner.test(segment)))
}

// Verdict lines runners print. Only summary shapes count, so a passing test
// whose name mentions "FAIL" or "3 errors" is no failure.
const FAILURE_MARKERS: readonly RegExp[] = [
  /^\s*Tests?:?\s.*\b[1-9]\d* fail(ed|ing|ures?)?\b/im, // jest, vitest, playwright, node --test
  /^\s*Test Files\s.*\b[1-9]\d* failed\b/im, // vitest
  /^\s*FAIL\s+\S/m, // jest file header
  /^--- FAIL:|^FAIL\s*$|^FAIL\t/m, // go test
  /\btest result: FAILED\b/, // cargo
  /^=+.*\b[1-9]\d* (failed|errors?)\b.*=+\s*$/m, // pytest summary
  /^not ok\b/m, // TAP
  /^\s*[1-9]\d* (failing|failures?)\b/m, // mocha, rspec
  /^FAILED \(/m, // unittest
  /^\s*# fail [1-9]/m, // node --test
]

/** True when a test command finished without an error result or a failure verdict. */
export function isPassingRun(output: string, isError: boolean): boolean {
  if (isError) return false
  return !FAILURE_MARKERS.some(marker => marker.test(output))
}

// Flags that make `git commit` print or check instead of committing.
const NO_COMMIT = /\s(--dry-run|-h|--help)(\s|=|$)/

/** True when one of the line's simple commands is a real `git commit`. */
export function isGitCommit(command: string): boolean {
  return simpleCommands(command).some(segment => /^git( -C \S+| -c \S+)* commit\b/.test(segment) && !NO_COMMIT.test(segment))
}

/**
 * True when a Bash command ran and exited non-zero. A run the user
 * interrupted, a call the user rejected and one a hook blocked are errors too,
 * but none of them starts with the exit code, so none of them counts.
 */
export function isFailedRun(output: string, isError: boolean): boolean {
  return isError && /^Exit code [1-9]\d*\b/.test(output) && !output.includes('[Request interrupted by user')
}

/** True when the user answered the permission dialog for a call with No or Esc. */
export function isRejectedCall(output: string, isError: boolean): boolean {
  return isError && output.startsWith("The user doesn't want to proceed with this tool use")
}
