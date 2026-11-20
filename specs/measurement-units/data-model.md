# Data model

measurement_units UUID id, code unique varchar30, name varchar100, symbol unique varchar30, group varchar10 checked, recommended_step decimal14,3 CHECK>0, status entity_status, timestamps. measurement_unit_aliases alias varchar30 PK, unit_id FK restrict. ingredients.unit_id nullable FK restrict, index. Các cột unit/default_unit cũ giữ nguyên. Alias normalize lower(trim(NFC)) trong app/migration; unknown code legacy_<md5> ổn định. Alias của đơn vị chưa hoạt động vẫn resolve khi đọc; ghi mới từ chối.
