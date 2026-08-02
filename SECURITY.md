# Security Policy

## Scope

Pkg Runner is a **local** desktop tool (Electron). The control plane binds to `127.0.0.1` only and uses a bearer token written under the app userData directory. Screenshot capture and script execution run with the privileges of the logged-in user.

## Reporting

If you find a vulnerability (especially around the control HTTP API, token discovery, or unintended process kill/port reap), please open a private report via the repository host (Gitee / GitHub security advisory if available), or contact the maintainer listed on the remote.

Please include:

- Affected version / commit
- Steps to reproduce
- Impact (local only vs. anything that could leave the machine)

## Non-goals

- Do not expose the control port beyond localhost.
- Do not commit `control/http.json`, userData prefs, or diagnostic logs that may contain paths / tokens.
- Issues that require physical or same-user access on an already compromised machine are out of scope unless they escalate beyond that user.
