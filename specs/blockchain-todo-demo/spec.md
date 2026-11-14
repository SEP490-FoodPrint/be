# Blockchain todo demo

## User stories

As a developer, I can create a todo from the demo page and see its hash stored in the local FoodPrint hash registry.

As a developer, I can submit edited todo text and see whether its hash matches the value read from the local contract.

## Requirements

- The development-only API accepts todo creation and hash verification requests.
- The API hashes the submitted text with the backend ethers library.
- Created records use unique IDs and the existing FoodPrintHashRegistry contract.
- The API reads the stored hash from the contract and returns the comparison result.
- Todo text and the demo list are not persisted in a database.
- Requests validate their shape and text length, and API responses use FoodPrint response envelopes.
- The endpoint is available only when the backend runs in development mode.

## Verification

- Create a todo, then verify identical text and changed text against the deployed local contract.
