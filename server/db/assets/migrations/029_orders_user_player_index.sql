-- SaveOrder / listByPlayer hot path: filter by user_id + player_id.

CREATE INDEX IF NOT EXISTS orders_user_player
  ON orders(user_id, player_id);
