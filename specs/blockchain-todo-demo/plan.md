# Plan

## Constitution Check

- Layered module architecture: PASS. Routes, validation and service are kept in src/modules/blockchain-todo.
- Database policy: PASS. The demo writes only to the local blockchain and creates no database model or migration.
- HTTP response and validation: PASS. Zod validates requests and shared response helpers preserve the API envelope.
- Spec-driven development: PASS. This plan, spec and tasks describe the feature on its feat/blockchain-todo-demo branch.

## Design

Register a development-only Express router. The service reads the local deployment artifact, checks chain ID and deployed bytecode, computes the input hash, then either writes a new record hash or reads and compares an existing one. Keep the browser todo list in page state.

## Validation

Run backend validate and unit tests, frontend production build, and the local Hardhat todo create/verify flow.
