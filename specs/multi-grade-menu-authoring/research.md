# Decisions

- Keep separate per-grade persistence. Adding a grade dimension to all existing cooking/history tables would enlarge scope and risk historical constraints.
- Reuse current recipe-preview endpoints once per grade. Removing the identical-profile guard from the old endpoint would make an ambiguous aggregate quantity appear valid.
- Reuse the existing school-row lock and Serializable transaction with live actor rechecks for atomic writes. Independent POST loops would leave partial menus and partial approval state.
- Preserve unchanged stored norms and portion-plan identities. The first grade's body is a common dish selection, not authority for other grades' quantities or group IDs.
- Group only presentation and compatible workflow state. A persisted merged menu was rejected because cooking demand must remain grade scoped.

All decisions use existing repository patterns; no new infrastructure or unresolved design dependency remains.
