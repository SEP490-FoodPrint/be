# Plan

## Constitution Check

Use the existing authenticated school-scoped endpoints and transactional writes. Store one optional image per record on Cloudinary as a private authenticated asset and record its identifier in an additive migration. Validate content and size on the server, issue short-lived links only after authorization, clean up uploaded assets if the database write fails or is an idempotent replay, and preserve existing photo-free requests. Never deploy the migration automatically. Test invalid image handling, historical records, authorization scope, retry behavior, and both creation flows.
