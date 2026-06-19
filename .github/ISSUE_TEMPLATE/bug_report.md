name: 🐛 Bug Report
about: Create a report to help us improve the ACP Client
title: "[BUG] "
labels: bug
assignees: ""

body:

- type: markdown
  attributes:
  value: |
  Please fill out as much information as possible to help us reproduce and resolve the bug.

- type: textarea
  id: description
  attributes:
  label: Description
  description: A clear and concise description of what the bug is.
  placeholder: Describe the problem...
  validations:
  required: true

- type: textarea
  id: reproduction
  attributes:
  label: Steps To Reproduce
  description: Steps to reproduce the behavior.
  placeholder: | 1. Initialize AcpClient with... 2. Run... 3. See error...
  validations:
  required: true

- type: textarea
  id: expected
  attributes:
  label: Expected Behavior
  description: A clear and concise description of what you expected to happen.
  placeholder: What did you expect to happen?
  validations:
  required: true

- type: textarea
  id: logs
  attributes:
  label: Environment Info & Logs
  description: Node.js version, pnpm version, OS, client log output, etc.
  placeholder: |
  Node: v20.x
  pnpm: v11.x
  OS: Windows/macOS/Linux
  Logs: ...
