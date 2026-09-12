# ADR-0010: Grant authority by action class; the person grants the merge

- Status: accepted
- Decision: [D-041](../11-open-decisions.md), [D-022](../11-open-decisions.md), [D-071](../11-open-decisions.md)

## Decision

Every action belongs to a class, and each class has its own authority:

| Class | Who may act |
|---|---|
| Observe and draft | Models may draft. Nothing a model drafts is canonical until a person approves it (D-071). |
| Bounded execution | The executor, on admitted work only, inside the approved contract's scope. |
| Merge | The person. A repository may opt into `merge: loop`, which lets the loop merge under D-041's gate. |
| Prohibited | Nobody, whatever a person or a model asks (D-022). |

Authority moves only by a person's explicit choice, per repository and per class. A model's confidence never grants it.

## Consequences

A person's attention goes to consequential choices, while routine, reversible work proceeds. A repository that never opts in never has a pull request merged by the loop.

## Reversal trigger

A loop merge is reverted, or charged with an escape a review should have caught.
