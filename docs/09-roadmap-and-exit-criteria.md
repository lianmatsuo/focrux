# Roadmap

What comes next, in order. A step is done when its condition holds; the [backlog](../backlog/issues.json) holds the tickets.

1. **The records finish their cleanup.** The evaluation records and the measurement programme's code are removed, and code comments citing removed decisions are rewritten ([D-111](11-open-decisions.md), [D-099](11-open-decisions.md)).
2. **Release.** The public tree is this repository's tree without the material that stays private ([D-076](11-open-decisions.md)), so it carries everything that runs on one machine ([D-075](11-open-decisions.md)). It is verified, then pushed as `lianmatsuo/focrux`, which becomes where Focrux is developed, and every corpus fixture is published in `plantedbugs`: **80 defective fixtures across seven classes and 28 clean**. The product-regulation artefacts come with it ([D-048](11-open-decisions.md)).
3. **First people.** The co-founder uses Focrux, and the design partner starts once [D-084](11-open-decisions.md)'s list holds, with their baseline captured first.
4. **The loop's next capabilities:**
   - large work as one ticket with an execution graph, planning mode, the interview, specs, sizes and per-node review (D-100, D-101, D-102, D-103, D-104, D-107);
   - executor subagents (D-106);
   - the stall detector in place of cost and time ceilings (D-096);
   - prohibited paths refused at write time (D-105);
   - reading other tools' reviews (D-088);
   - a merge that trusts only its own review run's verdict and never refuses an unsigned commit (D-041, D-091).

   All of these are in [the register](11-open-decisions.md); [planning mode and execution graphs](planning-mode-and-execution-graphs.md) shows how the planning pieces fit together.
5. **The control plane:** team memory first, then the operating modules paying users choose ([D-016](11-open-decisions.md)). Its design is recorded, decided and not built, and stays private ([D-076](11-open-decisions.md)).

Progress is judged by real use ([D-099](11-open-decisions.md)).
