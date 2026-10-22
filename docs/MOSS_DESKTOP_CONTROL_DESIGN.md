# MOSS desktop-control integration

This project uses its existing `yun-desktop-agent` WebSocket service as the local execution boundary. MOSS backend code never gives a model a shell, PowerShell, CMD, file deletion, or arbitrary script capability.

## Borrowed design principles

- From Microsoft UFO and WindowsAgentArena: separate planning from local execution, keep receipts, and test actions in a repeatable environment.
- From desktop-touch-mcp: discover available capabilities first; future UI automation must verify the active target before input.
- From windows-computer-use-mcp: expose narrowly named tools, keep an execution log, and require human confirmation for high-impact actions.

## Current integration

`get_desktop_capabilities` calls the live local WebSocket action `list_tools`. It reports the agent's actual advertised capabilities without enabling them for model use.

Enabled MOSS tools are limited to system status, desktop-agent status, capability discovery, supported application launch/close, and volume read/write. Script hosts and command interpreters are rejected server-side even when the local desktop agent lists aliases for them.

## Not enabled

Screen capture, mouse movement/clicking, text typing, key presses, filesystem access, browser navigation, messaging, deletion, and arbitrary commands remain disabled. Enabling any of these requires a separate scoped permission design, explicit user confirmation, target validation, and execution verification.
