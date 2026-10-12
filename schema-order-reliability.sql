-- Apply before deploying the matching Web / APK release.
-- All order mutations run in one transaction. No changes to existing orders on install.
BEGIN;
CREATE TABLE IF NOT EXISTS public.fos_order_requests (
  actor_id text NOT NULL,
  request_id text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
ALTER TABLE public.fos_order_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fos_order_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_mutate_order(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor public.users%ROWTYPE;
  merchant public.merchants%ROWTYPE;
  ord public.orders%ROWTYPE;
  prod public.products%ROWTYPE;
  line public.order_items%ROWTYPE;
  item jsonb;
  previous public.fos_order_requests%ROWTYPE;
  clean jsonb := p_payload - 'password';
  operation text := p_payload->>'operation';
  v_request_id text := p_payload->>'request_id';
  v_qty integer;
  v_shortage integer;
  sub numeric;
  tax numeric;
  merged boolean := false;
  result jsonb;
BEGIN
  -- Compatible with the application's current credential format. Never store passwords here.
  SELECT * INTO actor FROM public.users
    WHERE id = p_payload->>'actor_id' AND active = true
      AND password_hash = p_payload->>'password';
  IF NOT FOUND THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT * INTO merchant FROM public.merchants WHERE id = actor.merchant_id;
  IF NOT FOUND OR merchant.status <> 'active' THEN RAISE EXCEPTION '商家不可用'; END IF;
  IF actor.role NOT IN ('order', 'factory', 'delivery') THEN RAISE EXCEPTION '无操作权限'; END IF;
  IF (actor.role = 'order' AND NOT merchant.allow_order_app)
    OR (actor.role = 'factory' AND NOT merchant.allow_admin_app AND NOT merchant.allow_production_app)
    OR (actor.role = 'delivery' AND NOT merchant.allow_production_app)
    THEN RAISE EXCEPTION '该端已停用'; END IF;
  IF v_request_id IS NULL OR length(v_request_id) < 16 OR length(v_request_id) > 100 THEN
    RAISE EXCEPTION '请求标识无效';
  END IF;
  -- Serialize retries, including a response lost after COMMIT.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor.id || ':' || v_request_id, 0));
  SELECT * INTO previous FROM public.fos_order_requests r
    WHERE r.actor_id = actor.id AND r.request_id = v_request_id;
  IF FOUND THEN
    IF previous.payload <> clean THEN RAISE EXCEPTION '请求内容已改变'; END IF;
    RETURN previous.result;
  END IF;

  IF operation = 'submit' THEN
    IF actor.role <> 'order' OR NOT merchant.allow_order THEN RAISE EXCEPTION '不可下单'; END IF;
    IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_payload->'items') = 0 THEN RAISE EXCEPTION '购物车为空'; END IF;
    -- One open order per shop/day even when two devices submit simultaneously.
    PERFORM pg_advisory_xact_lock(hashtextextended(actor.id || ':' || (p_payload->>'order_date')::date::text, 1));
    IF EXISTS (SELECT 1 FROM public.orders WHERE shop_id = actor.id
      AND merchant_id = merchant.id AND status = 'delivered' AND receipt_confirmed = false)
      THEN RAISE EXCEPTION '请先确认收货'; END IF;
    SELECT * INTO ord FROM public.orders WHERE shop_id = actor.id AND merchant_id = merchant.id
      AND order_date = (p_payload->>'order_date')::date AND status IN ('pending','preparing')
      ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    merged := FOUND;
    IF NOT merged THEN
      INSERT INTO public.orders(shop_id, shop_name, merchant_id, order_date, note)
      VALUES(actor.id, actor.name, merchant.id, (p_payload->>'order_date')::date, coalesce(p_payload->>'note',''))
      RETURNING * INTO ord;
    ELSE
      UPDATE public.orders SET note = concat_ws(E'\n', nullif(note,''), nullif(p_payload->>'note',''))
      WHERE id = ord.id;
    END IF;
    UPDATE public.orders SET shop_submitted_at = NULL WHERE id = ord.id;
    -- Consistent lock order avoids deadlocks between overlapping baskets.
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'product_id'
    LOOP
      IF coalesce(item->>'qty','') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION '数量无效'; END IF;
      v_qty := (item->>'qty')::integer;
      SELECT * INTO prod FROM public.products WHERE id::text = item->>'product_id'
        AND merchant_id = merchant.id AND active = true FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION '商品不存在或已下架'; END IF;
      IF prod.price IS NULL OR prod.price < 0 OR coalesce(prod.tax_rate,0) NOT BETWEEN 0 AND 100
        THEN RAISE EXCEPTION '商品价格或税率无效：%', prod.name; END IF;
      UPDATE public.products SET stock = stock - v_qty, updated_at = now()
        WHERE id = prod.id AND stock >= v_qty;
      IF NOT FOUND THEN RAISE EXCEPTION '库存不足：%', prod.name; END IF;
      SELECT * INTO line FROM public.order_items WHERE order_id = ord.id AND product_id = prod.id
        ORDER BY id LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        UPDATE public.order_items SET qty = order_items.qty + v_qty WHERE id = line.id;
      ELSE
        INSERT INTO public.order_items(order_id,product_id,product_name,product_spec,product_emoji,unit_price,tax_rate,qty)
        VALUES(ord.id,prod.id,prod.name,coalesce(prod.spec,''),coalesce(prod.emoji,'📦'),prod.price,coalesce(prod.tax_rate,0),v_qty);
      END IF;
    END LOOP;
  ELSE
    SELECT * INTO ord FROM public.orders WHERE id::text = p_payload->>'order_id'
      AND merchant_id = merchant.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '订单不存在或无权限'; END IF;
    IF actor.role = 'order' AND (ord.shop_id <> actor.id OR operation NOT IN ('receipt','confirm'))
      THEN RAISE EXCEPTION '无操作权限'; END IF;
    IF actor.role = 'delivery' AND nullif(to_jsonb(ord)->>'assigned_driver_id','') IS NOT NULL
      AND to_jsonb(ord)->>'assigned_driver_id' <> actor.id THEN RAISE EXCEPTION '订单未分配给当前配送员'; END IF;
    IF operation = 'confirm' THEN
      UPDATE public.orders SET shop_submitted_at = now(), updated_at = now() WHERE id = ord.id;
    ELSIF operation = 'receipt' THEN
      IF ord.status NOT IN ('delivered','confirmed') THEN RAISE EXCEPTION '订单尚未配送完成'; END IF;
      UPDATE public.orders SET receipt_confirmed = true, receipt_confirmed_at = now(),
        status = 'confirmed', updated_at = now() WHERE id = ord.id;
    ELSIF operation = 'status' THEN
      IF p_payload->>'status' NOT IN ('pending','preparing','shipped','delivered','cancelled')
        OR p_payload->>'status' IS NULL THEN RAISE EXCEPTION '订单状态无效'; END IF;
      UPDATE public.orders SET status = p_payload->>'status', updated_at = now(),
        delivery_status = CASE WHEN order_source IN ('public_order','wechat_group','public_qr')
          THEN CASE p_payload->>'status' WHEN 'pending' THEN 'new' WHEN 'preparing' THEN 'accepted'
            WHEN 'shipped' THEN 'delivering' ELSE p_payload->>'status' END ELSE delivery_status END
        WHERE id = ord.id;
    ELSIF operation = 'edit' THEN
      IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '订单明细无效'; END IF;
      IF p_payload->>'expected_updated_at' IS NULL
        OR ord.updated_at IS DISTINCT FROM (p_payload->>'expected_updated_at')::timestamptz
        THEN RAISE EXCEPTION '订单已更新，请重新打开订单后编辑'; END IF;
      IF p_payload->>'status' IS NULL OR p_payload->>'status' NOT IN
        ('pending','preparing','shipped','delivered','confirmed','cancelled') THEN RAISE EXCEPTION '订单状态无效'; END IF;
      -- Existing administrative edits do not move stock; preserve that business rule.
      -- The complete edit and recalculation either commit together or roll back together.
      FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
        SELECT * INTO line FROM public.order_items WHERE id::text = item->>'id' AND order_id = ord.id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION '订单明细已改变，请刷新'; END IF;
        IF coalesce((item->>'remove')::boolean,false) THEN
          DELETE FROM public.order_items WHERE id = line.id;
          CONTINUE;
        END IF;
        IF coalesce(item->>'qty','') !~ '^[0-9]+$' THEN RAISE EXCEPTION '数量无效'; END IF;
        v_qty := (item->>'qty')::integer;
        IF v_qty = 0 THEN DELETE FROM public.order_items WHERE id = line.id; CONTINUE; END IF;
        v_shortage := least(v_qty,greatest(0,coalesce(nullif(item->>'shortageQty','')::integer,0)));
        UPDATE public.order_items SET qty=v_qty,shortage_qty=v_shortage,shortage=(v_shortage>0),
          shortage_note=coalesce(item->>'shortageNote',''),
          admin_edit=CASE WHEN admin_edit='added' THEN 'added'
            WHEN qty<>v_qty OR shortage_qty<>v_shortage THEN 'modified' ELSE admin_edit END
          WHERE id=line.id;
      END LOOP;
      FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'addItems','[]'::jsonb))
        ORDER BY value->>'product_id' LOOP
        IF coalesce(item->>'qty','') !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION '数量无效'; END IF;
        v_qty := (item->>'qty')::integer;
        SELECT * INTO prod FROM public.products WHERE id::text=item->>'product_id' AND merchant_id=merchant.id;
        IF NOT FOUND THEN RAISE EXCEPTION '商品不存在'; END IF;
        IF prod.price IS NULL OR prod.price < 0 OR coalesce(prod.tax_rate,0) NOT BETWEEN 0 AND 100
          THEN RAISE EXCEPTION '商品价格或税率无效：%', prod.name; END IF;
        SELECT * INTO line FROM public.order_items WHERE order_id=ord.id AND product_id=prod.id ORDER BY id LIMIT 1;
        IF FOUND THEN
          UPDATE public.order_items SET qty=order_items.qty+v_qty,
            admin_edit=CASE WHEN admin_edit='added' THEN 'added' ELSE 'modified' END WHERE id=line.id;
        ELSE
          INSERT INTO public.order_items(order_id,product_id,product_name,product_spec,product_emoji,unit_price,tax_rate,qty,admin_edit)
          VALUES(ord.id,prod.id,prod.name,coalesce(prod.spec,''),coalesce(prod.emoji,'📦'),
            CASE WHEN ord.order_source IN ('public_order','wechat_group','public_qr') THEN coalesce(prod.public_price,prod.price)
              ELSE prod.price END,coalesce(prod.tax_rate,0),v_qty,'added');
        END IF;
      END LOOP;
      UPDATE public.orders SET status=p_payload->>'status',factory_note=coalesce(p_payload->>'factoryNote',''),
        updated_at=now() WHERE id=ord.id;
    ELSIF operation <> 'recalc' THEN
      RAISE EXCEPTION '未知订单操作';
    END IF;
  END IF;
  IF operation IN ('submit','recalc','edit') THEN
    IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id=ord.id AND
      (qty IS NULL OR qty <= 0 OR unit_price IS NULL OR unit_price < 0 OR tax_rate IS NULL OR tax_rate NOT BETWEEN 0 AND 100))
      THEN RAISE EXCEPTION '订单明细金额或数量无效，请检查'; END IF;
    -- Errors abort the transaction; they can never be treated as an empty item list.
    SELECT coalesce(sum(amount),0), coalesce(sum(round(amount * tax_rate / 100)),0) INTO sub,tax
    FROM (SELECT unit_price * greatest(0, qty - CASE
        WHEN coalesce((to_jsonb(i)->>'shortage_qty')::integer,0) > 0
          THEN least(qty,(to_jsonb(i)->>'shortage_qty')::integer)
        WHEN shortage THEN qty ELSE 0 END) AS amount, tax_rate
      FROM public.order_items i WHERE order_id = ord.id) billed;
    UPDATE public.orders SET subtotal=sub,tax_total=tax,total=sub+tax,updated_at=now() WHERE id=ord.id;
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = ord.id;
  result := jsonb_build_object('id',ord.id,'order_no',ord.order_no,'total',ord.total,
    'sub',ord.subtotal,'tax',ord.tax_total,'merged',merged,'shop_submitted_at',ord.shop_submitted_at);
  INSERT INTO public.fos_order_requests(actor_id,request_id,payload,result)
    VALUES(actor.id,v_request_id,clean,result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_mutate_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fos_mutate_order(jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
