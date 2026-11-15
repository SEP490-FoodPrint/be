# Data model

No schema change. Reuse WeeklyMenu/WeeklyMenuGrade, MenuDay, MenuDayDishIngredient, MenuMealSeasoning and portion-group tables. Each newly batch-authored menu applies to exactly one selected grade; multiple records share the user's logical dish schedule. Existing combined-grade records remain intact.

Main ingredients and seasonings retain their own Decimal quantities/units per grade. Grade membership continues to scope class demand, allergies, cooking batches and allocations through the existing menu-day relationships. Read-only previews never reserve ingredient lots or create cooking batches.

The display group is computed from menu content; it has no persisted ID and grants no additional permission. Selecting one grade resolves its actual WeeklyMenu/MenuDay IDs. Group submission carries every member ID into a single authorized transaction.
