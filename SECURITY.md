# Security Policy

Vertaal is a local desktop application — it doesn't run a server, doesn't send your data anywhere by default, and stores everything (including any API keys you enter for translation providers) in a local SQLite database on your own machine, outside the project's source tree.

## What counts as a security issue here

Given the above, the security-relevant surface area is narrower than for a typical web app, but still real. Examples of what belongs here rather than a normal bug report:

- A way for imported or translated text to cause Vertaal to read or write files outside the folders it's supposed to touch
- API keys, GitHub tokens, or other credentials being stored, logged, or transmitted insecurely
- A dependency (npm package or Rust crate) with a known vulnerability that's actually reachable in how Vertaal uses it
- Any way for a malicious mod file, localization file, or glossary import to execute unintended code rather than just be parsed as data

Bugs that just produce wrong output, a crash, or a bad translation are **not** security issues — please file those as normal [GitHub Issues](https://github.com/bakgat-beep/vertaal/issues) instead.

## Reporting a vulnerability

Please **do not** open a public issue for a security concern. Instead, use GitHub's private reporting feature: go to the **Security** tab on this repository → **Report a vulnerability**. This opens a private conversation with the maintainer that isn't visible publicly until it's resolved.

If you're not able to use that for some reason, contact the maintainer directly through their GitHub profile rather than filing a public issue.

Please include:
- What the issue is and why it's a security concern (not just "this seems wrong")
- Steps to reproduce it, as specific as possible
- What version of Vertaal you're using

There's no bug bounty — this is a small hobby project — but genuine reports are taken seriously and credited in the release notes once fixed, unless you'd prefer to stay anonymous.
