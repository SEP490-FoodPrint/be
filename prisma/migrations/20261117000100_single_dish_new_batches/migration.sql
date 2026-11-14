-- Preserve all historical multi-dish batches; enforce the invariant on future writes.
-- Serialize insertions for the same batch so concurrent writers cannot add two dishes.
CREATE FUNCTION foodprint.enforce_single_dish_new_batch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM foodprint.cooking_batches WHERE id = NEW.cooking_batch_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM foodprint.cooking_batch_dishes
      WHERE cooking_batch_id = NEW.cooking_batch_id AND dish_id <> NEW.dish_id
        AND NOT (cooking_batch_id = OLD.cooking_batch_id AND dish_id = OLD.dish_id)
    ) THEN
      RAISE EXCEPTION 'Cooking batch may contain only one dish'
        USING ERRCODE = '23514', CONSTRAINT = 'cooking_batch_single_dish';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM foodprint.cooking_batch_dishes
    WHERE cooking_batch_id = NEW.cooking_batch_id AND dish_id <> NEW.dish_id
  ) THEN
    RAISE EXCEPTION 'Cooking batch may contain only one dish'
      USING ERRCODE = '23514', CONSTRAINT = 'cooking_batch_single_dish';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cooking_batch_single_dish
BEFORE INSERT OR UPDATE OF cooking_batch_id, dish_id
ON foodprint.cooking_batch_dishes
FOR EACH ROW EXECUTE FUNCTION foodprint.enforce_single_dish_new_batch();

-- Child creation and dish insertion can occur in either order in a transaction.
-- At commit, newly inserted children and removed/moved dish rows must leave one dish.
CREATE FUNCTION foodprint.require_batch_dish_at_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE batch_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'cooking_batches' THEN
    batch_id := NEW.id;
  ELSE
    batch_id := OLD.cooking_batch_id;
  END IF;
  IF EXISTS (SELECT 1 FROM foodprint.cooking_batches WHERE id = batch_id)
     AND NOT EXISTS (SELECT 1 FROM foodprint.cooking_batch_dishes WHERE cooking_batch_id = batch_id) THEN
    RAISE EXCEPTION 'Cooking batch must contain a dish'
      USING ERRCODE = '23514', CONSTRAINT = 'cooking_batch_requires_dish';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER cooking_batch_requires_dish_on_create
AFTER INSERT ON foodprint.cooking_batches
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION foodprint.require_batch_dish_at_commit();

CREATE CONSTRAINT TRIGGER cooking_batch_requires_dish_on_remove
AFTER DELETE OR UPDATE ON foodprint.cooking_batch_dishes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION foodprint.require_batch_dish_at_commit();
