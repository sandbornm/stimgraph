# Repository instructions

## Secret handling

- Treat `.env.local`, `.env`, and every `.env.*` file except `.env.example` as secret.
- Never read, print, search, parse, source, interpolate, summarize, copy, upload, or pass those files to a tool.
- Never include secret values in commands, logs, patches, tests, screenshots, browser actions, or chat messages.
- Use `.env.example` to learn variable names. Ask the user to edit secret files themselves.
- Tests and builds must use inert test values supplied directly to the process when needed. They must not inspect local secret files.
- Keep dependency lifecycle scripts disabled. Review a package before allowing any install script.

