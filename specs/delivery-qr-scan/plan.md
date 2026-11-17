# Plan

## Constitution Check

- Validation (`delivery.validation.ts`) with `z.strictObject`; Request/Response DTOs in their own files; controller only parses and delegates.
- Service `lookup` applies `inspectionScope(principal)` and normalizes the scanned value; repository `findByScanCode` owns the Prisma query with the trusted `schoolId`.
- Read-only query; no transaction, migration, seed or remote database operation.

## Approach

1. Add `deliveryInspectionLookupSchema`, DTOs, `scannedDeliveryCode`, `lookup`, `findByScanCode`, controller handler and route `GET /deliveries/inspections/lookup`.
2. Frontend: `lookupDeliveryByCode` service, `DeliveryQrScanModal` with camera scan and manual input, button in the header.

## Verification

- Unit tests `tests/delivery-lookup.test.ts` (added to `test:unit`), typecheck, ESLint, Prettier.
