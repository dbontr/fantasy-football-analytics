# Browser Engine Implementation Plan

## Desired behavior

Create a separate repository that preserves the Oracle's advanced fantasy decision behavior while making GitHub Pages + the browser the complete production runtime.

## Constraints

- Free/public data only; no required token, OAuth, payment method, trial, or paid fallback.
- No custom GitHub Actions.
- No backend process in production.
- Existing `fantasy-football-oracle` repository remains untouched.
- Static bootstrap must work when optional live sources are unreachable.
- Heavy computation must not block the UI thread.

## Phases

1. **Repository and parity audit** — complete.
2. **Compact bootstrap + deterministic core migration** — complete.
3. **Distribution/evidence/context runtime** — complete.
4. **Correlated Monte Carlo + robust decision engine** — complete.
5. **Season/playoff/title simulator** — complete.
6. **Free-source adapters + local persistence** — complete.
7. **Decision-room UI + Worker integration** — complete.
8. **Unit/static/browser QA** — complete.
9. **GitHub Pages branch publication** — pending final push/configuration.
