-- Two sellers, three months, deliberately different volumes + the edge cases that matter.
-- A = big shipper, B = small. Nov is the month we price December from.
insert into orders (id, seller_id, factory_status, shipped_at) values
  -- Seller A, Nov: 3 orders -> 40+60+20 = 120 units
  ('A-1','11111111-1111-1111-1111-111111111111','shipped','2025-11-05T10:00:00Z'),
  ('A-2','11111111-1111-1111-1111-111111111111','shipped','2025-11-18T10:00:00Z'),
  ('A-3','11111111-1111-1111-1111-111111111111','shipped','2025-11-29T23:59:00Z'),
  -- Seller A, Dec: should NOT count toward November
  ('A-4','11111111-1111-1111-1111-111111111111','shipped','2025-12-01T00:01:00Z'),
  -- Seller A, Nov but CANCELLED -> excluded
  ('A-5','11111111-1111-1111-1111-111111111111','cancelled','2025-11-10T10:00:00Z'),
  -- Seller A, Nov but never shipped -> excluded
  ('A-6','11111111-1111-1111-1111-111111111111','working', null),
  -- Seller B, Nov: 1 order, 9 units (just under a 10 tier)
  ('B-1','22222222-2222-2222-2222-222222222222','shipped','2025-11-15T10:00:00Z');
insert into order_items (order_id, qty) values
  ('A-1',40),('A-2',60),('A-3',20),
  ('A-4',500),
  ('A-5',999),
  ('A-6',999),
  ('B-1',9);
