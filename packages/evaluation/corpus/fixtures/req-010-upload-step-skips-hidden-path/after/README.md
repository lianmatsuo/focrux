# suite

A regression suite whose run writes its records under `.regression/` at the repository root: `summary.json`
with the rows, and one file per review beside it. The records are what a contributor reads when a
row moves; the job log prints the rows, and the run's records are attached to the run as the
`regression-run` artifact, so the review that moved a row is one download away.
