import { execFile } from "node:child_process";

const CLI_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface RunClaudeOptions {
  /** Working directory for the Claude CLI process */
  cwd: string;
  /** Model to use (defaults to claude-sonnet-4-6) */
  model?: string;
  /** Effort level (defaults to low) */
  effort?: string;
}

/**
 * Run a prompt through the Claude Code CLI and return raw text output.
 * Spawns `claude -p` with `--dangerously-skip-permissions`.
 */
export function runClaude(prompt: string, options: RunClaudeOptions): Promise<string> {
  const startTime = Date.now();
  const model = options.model ?? "claude-sonnet-4-6";
  const effort = options.effort ?? "low";

  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      [
        "-p",
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
        "--model",
        model,
        "--effort",
        effort,
      ],
      {
        timeout: CLI_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        cwd: options.cwd,
        env: { ...process.env, CLAUDECODE: "" },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("[runClaude] CLI error:", error.message);
          if (stderr) console.error("[runClaude] stderr:", stderr);
          return reject(new Error(`Claude CLI failed: ${error.message}`));
        }

        const raw = stripAnsi(stdout).trim();
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

        // Parse JSON to extract usage stats and result text
        try {
          const parsed = JSON.parse(raw);

          if (parsed.usage) {
            console.log(
              `[runClaude] Token usage: input=${parsed.usage.input_tokens}, output=${parsed.usage.output_tokens}, cache_read=${parsed.usage.cache_read_input_tokens ?? 0}, cache_create=${parsed.usage.cache_creation_input_tokens ?? 0} | elapsed=${elapsedSec}s`,
            );
          }

          // Extract the text result from JSON response
          const text = parsed.result ?? parsed.text ?? parsed.content ?? "";
          resolve(typeof text === "string" ? text : JSON.stringify(text));
        } catch {
          // If JSON parsing fails, fall back to raw text
          console.warn(
            `[runClaude] Could not parse JSON output, falling back to raw text | elapsed=${elapsedSec}s`,
          );
          resolve(raw);
        }
      },
    );

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

/** Strip ANSI escape codes from CLI output */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/** Extract HTML from output — find <!DOCTYPE or <html to </html> */
export function extractHtml(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:html)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    if (inner.includes("<!DOCTYPE") || inner.includes("<html")) {
      return inner;
    }
  }

  // Find the HTML document in the output
  const docStart = raw.indexOf("<!DOCTYPE");
  const htmlStart = docStart !== -1 ? docStart : raw.indexOf("<html");
  if (htmlStart === -1) {
    console.error(
      "[extractHtml] No HTML found. Output starts with:",
      raw.slice(0, 500),
    );
    throw new Error("No HTML document found in Claude output");
  }

  const htmlEnd = raw.lastIndexOf("</html>");
  if (htmlEnd === -1) {
    throw new Error("No closing </html> tag found in Claude output");
  }

  return raw.slice(htmlStart, htmlEnd + "</html>".length);
}
