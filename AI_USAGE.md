# AI usage

## My approach

I used AI as an engineering tool, with responsibility for directing the work,
reviewing its output and validating the result. I decided what to build,
provided instructions and feedback, and used AI where it could help with
exploring ideas, implementing code and identifying potential issues.

This reflects how I approach work in both corporate and startup environments:
use available tools purposefully, apply engineering judgment and remain
accountable for the work delivered.

## Where AI contributed

- **Brainstorming and planning.** I used AI to explore implementation approaches
  and break the assessment requirements into manageable stages.
- **Code implementation.** AI generated substantial portions of the
  implementation under my direction, including the PostgreSQL schema and
  migrations, FastAPI API and rule engine, Angular views, Docker Compose
  configuration, seed and benchmark commands, tests and draft documentation.
- **Code review and security.** I reviewed the generated code and used AI for
  additional review, dependency vulnerability scans through `npm audit` and
  `pip-audit`, and fixes documented in `SECURITY_REVIEW.md`.
- **Usability.** I directed improvements to rule limits, field-level
  validation, loading and empty states, and retry behaviour.

## My review and verification

I provided direction and feedback throughout development and reviewed the
AI-generated code. AI-assisted review complemented my own review.

I ran the project from a fresh clone, covering Docker startup, database
seeding, 90 backend tests—including 25 PostgreSQL tests—16 browser tests and
the latency benchmark. The worst first-page p95 latency was 2.1 ms directly to
the API and 4.2 ms through Nginx. During verification, I corrected a broken
test assertion, and the documentation was updated with the measured results.

AI contributed substantially to writing the code. My contribution was directing
the solution, reviewing the implementation, guiding revisions and verifying the
delivered behaviour. I take responsibility for the submitted work and for
explaining its design choices and limitations.
