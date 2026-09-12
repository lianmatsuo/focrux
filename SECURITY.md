# Security

Report a vulnerability privately, through
[GitHub's private vulnerability reporting](https://github.com/lianmatsuo/focrux/security/advisories/new)
for this repository. Do not open a public issue for it: the "Security or trust boundary"
issue template is for design work on the boundary, not for a report against it.

## What counts

Focrux runs coding agents on a person's machine and judges their work, so its
security claims are about containment and judgement. A report is in scope when
it shows any of these holding less than [docs/08](docs/08-security-autonomy-and-data.md) says:

- the executor writes outside the scope its contract approved, or the write guard
  lets a command through that the permission profile refuses;
- repository content, an issue body, a pull request, a check's output or a tool
  result reaches a model in an instruction position rather than as data
  ([ADR-0023](docs/adr/0023-untrusted-context-boundary.md));
- repository-supplied agent configuration — hooks, tool servers, memory files,
  skills — reaches the executor or the reviewer ([ADR-0030](docs/adr/0030-neutralise-repository-supplied-agent-configuration.md));
- a credential or a materialized secret reaches a model call, a run bundle, a
  pull request or a log;
- the executor is given the queue endpoint's token or address, or a token holder
  can do more through the endpoint than draft, edit an unapproved contract, sync,
  pause or resume ([D-109](docs/11-open-decisions.md));
- the reviewer's verdict can be moved by anything other than the plan, the
  change set, the check results and the files it selects itself.

## What to expect

The maintainer reads reports there and replies in the advisory. A fix ships as
a pull request like any other change, with the advisory published once it has
merged, and a corpus fixture is added for the class of defect where one is
possible, so the reviewer is scored against it from then on.

Focrux has no hosted service and holds no user data; there is nothing to
disclose about a breach of one.
