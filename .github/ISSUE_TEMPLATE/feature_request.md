name: ✨ Feature Request / Task
about: Suggest an idea, enhancement, or specific task
title: "[FEATURE] "
labels: enhancement
assignees: ""

body:

- type: textarea
  id: problem
  attributes:
  label: Is your feature request related to a problem?
  description: A clear and concise description of what the problem is. (e.g. "I'm frustrated when...")
  placeholder: Describe the problem...
  validations:
  required: false

- type: textarea
  id: solution
  attributes:
  label: Describe the proposed solution or task
  description: A clear and concise description of what you want to happen.
  placeholder: Describe the solution or new feature...
  validations:
  required: true

- type: textarea
  id: alternatives
  attributes:
  label: Describe alternatives you've considered
  description: A clear and concise description of any alternative solutions or features you've considered.
  placeholder: Describe alternatives...
  validations:
  required: false

- type: textarea
  id: context
  attributes:
  label: Additional Context
  description: Any other context, screenshots, or code examples related to the feature request.
  placeholder: Add context...
