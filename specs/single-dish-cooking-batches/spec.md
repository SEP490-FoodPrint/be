# Single-dish cooking batches

Every newly planned child cooking batch represents exactly one dish and its allocated portions and ingredient lots. Combine mode produces one child per dish; separate mode produces one child per dish and lot allocation. Sample each completed child independently and show 0/1 or 1/1 batches. Existing multi-dish history must remain readable and unchanged. Database enforcement must reject new extra dish rows without rewriting historical records. Preview, stock reservations, finalization, allocation and traceability retain existing guarantees.
