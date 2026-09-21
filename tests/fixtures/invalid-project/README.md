# Intentional invalid fixture

Every file in this fixture is valid except `project.json`, whose manuscript order
contains the same valid chapter UUID twice. The expected loader failure is
`PROJECT_ORDER_INVALID` for a duplicate chapter order.
