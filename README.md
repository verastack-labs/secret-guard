# secret-guard

A Claude Code mod that stops Claude from writing, running or committing secrets.

It blocks API keys, tokens and private keys in:

- files Claude writes or edits (Write, Edit, NotebookEdit),
- commands Claude runs (Bash, PowerShell),
- `git add` of secrets files like `.env`, `*.pem` and `id_rsa`,
- `git commit` when the staged changes add a secret or a secrets file.

Claude is told what was found, with the secret masked, and asked to read the value from an environment variable instead. You see a toast and a running count in the status line.

## Install

In a terminal Claude Code session (Claude Code 2.1.295 or newer):

```
/plugin install secret-guard --marketplace verastack-labs/secret-guard
```

Answer `y` to add the marketplace, then pick a scope. The guard is active at once.

## Letting one call through

For a placeholder or a test value, run:

```
/allow-secret
```

The next call secret-guard would block goes through once. Running it twice still allows one call.

## What it recognises

GitHub tokens, Anthropic keys, OpenAI keys, AWS access keys, Stripe live keys, Slack tokens, Google API keys, npm tokens and private key headers. Each needs a known prefix or structure, so false positives are rare.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Extra patterns | none | More secrets to block, one per entry, written `Name=regex`. |
| Skip paths | `**/fixtures/**`, `**/__snapshots__/**`, `*.test.*`, `*.spec.*` | Files whose content is never scanned. Secrets files like `.env` are still blocked from git. |
| Git checkpoint | on | Checks `git add` and `git commit`. |

## Limits

secret-guard sees only what Claude does. Commits you make in your own terminal are not checked. It follows one leading `cd` or `git -C`, not longer chains of directory changes. It does not hide secrets that Claude reads from existing files.

## Development

```
claude plugin test .
claude plugin validate .
```

## Licence

Apache 2.0. See `LICENSE`.
