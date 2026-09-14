-- =============================================================================
-- EXECUTION INVARIANTS
--
-- The controls that stop a facility paying for goods it never received, and
-- reporting equipment as usable when it is still in a crate.
--
--   1. Every unit received is either accepted or rejected
--   2. Rejecting something requires saying why
--   3. A purchase order line total agrees with its own quantity and rate
--   4. An invoice cannot be paid without a goods receipt (criterion E/F)
--   5. An asset is COMMISSIONED only when every check passes (criterion F)
--   6. Task progress is a percentage, and COMPLETED means 100
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 and 2. Goods receipt lines
--
-- A unit that is neither accepted nor rejected has vanished between the
-- delivery van and the ledger, and the three-way match would value it wrongly.
-- -----------------------------------------------------------------------------

ALTER TABLE exec.goods_receipt_line
  ADD CONSTRAINT grn_line_quantities_account_for_everything CHECK (
    quantity_accepted + quantity_rejected = quantity_received
  );

COMMENT ON CONSTRAINT grn_line_quantities_account_for_everything ON exec.goods_receipt_line IS
  'Every unit received is either accepted or rejected. Nothing disappears between the van and the ledger.';

ALTER TABLE exec.goods_receipt_line
  ADD CONSTRAINT grn_line_rejection_is_explained CHECK (
    quantity_rejected = 0 OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) >= 5)
  );

ALTER TABLE exec.goods_receipt_line
  ADD CONSTRAINT grn_line_quantities_are_not_negative CHECK (
    quantity_received > 0 AND quantity_accepted >= 0 AND quantity_rejected >= 0
  );


-- -----------------------------------------------------------------------------
-- 3. A purchase order line states what it costs
-- -----------------------------------------------------------------------------

ALTER TABLE exec.purchase_order_line
  ADD CONSTRAINT po_line_total_is_derived CHECK (
    line_total_minor = round(quantity_ordered * unit_price_minor)
  );

COMMENT ON CONSTRAINT po_line_total_is_derived ON exec.purchase_order_line IS
  'Line total is quantity x unit price. Stored for reporting; constrained so it cannot drift.';


-- -----------------------------------------------------------------------------
-- 4. An invoice cannot be paid without a goods receipt
--
-- The headline control of spec §46 and the release acceptance criterion. The
-- service explains it; this trigger makes it true whoever is calling, including
-- a data fix run at midnight.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exec.reject_payment_without_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_purchase_order_id uuid;
  v_invoice_number    text;
  v_receipts          int;
BEGIN
  IF NEW.supplier_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT purchase_order_id, invoice_number
    INTO v_purchase_order_id, v_invoice_number
    FROM exec.supplier_invoice
   WHERE id = NEW.supplier_invoice_id;

  IF v_purchase_order_id IS NULL THEN
    RAISE EXCEPTION
      'Invoice % cites no purchase order, so there is nothing to match it against. It cannot be paid.',
      v_invoice_number
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_receipts
    FROM exec.goods_receipt_line l
    JOIN exec.goods_receipt g ON g.id = l.goods_receipt_id
   WHERE g.purchase_order_id = v_purchase_order_id
     AND l.quantity_accepted > 0;

  IF v_receipts = 0 THEN
    RAISE EXCEPTION
      'Invoice % has no goods receipt with anything accepted against it. Record what was actually received before paying.',
      v_invoice_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER payment_requires_goods_receipt
  BEFORE INSERT ON fin.payment
  FOR EACH ROW EXECUTE FUNCTION exec.reject_payment_without_receipt();

COMMENT ON FUNCTION exec.reject_payment_without_receipt() IS
  'Spec §46: a supplier invoice with no goods receipt behind it cannot be paid, whoever is calling.';


-- -----------------------------------------------------------------------------
-- 5. An asset is commissioned only when every check passes
--
-- Acceptance criterion F. A theatre lamp in a crate is not light in a theatre,
-- and reporting it as capacity puts a figure in a government report the
-- facility cannot deliver against.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION exec.reject_uncommissioned_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_passing int;
BEGIN
  IF NEW.commissioning_status <> 'COMMISSIONED' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.commissioning_status = 'COMMISSIONED' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_passing
    FROM exec.commissioning_record r
   WHERE r.asset_id = NEW.id
     AND r.functional_test_passed
     AND r.safety_check_passed
     AND r.staff_trained
     AND r.consumables_available
     AND r.utilities_connected;

  IF v_passing = 0 THEN
    RAISE EXCEPTION
      'Asset % cannot be commissioned: no commissioning record has all five checks passing. An asset that is not commissioned does not count toward service readiness.',
      NEW.asset_tag
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER asset_commissioning_requires_all_checks
  BEFORE INSERT OR UPDATE ON exec.equipment_asset
  FOR EACH ROW EXECUTE FUNCTION exec.reject_uncommissioned_asset();


-- -----------------------------------------------------------------------------
-- 6. Task progress
-- -----------------------------------------------------------------------------

ALTER TABLE exec.project_task
  ADD CONSTRAINT task_percent_is_a_percentage CHECK (percent_complete >= 0 AND percent_complete <= 100);

ALTER TABLE exec.project_task
  ADD CONSTRAINT task_completed_means_finished CHECK (
    status <> 'COMPLETED' OR percent_complete = 100
  );

COMMENT ON CONSTRAINT task_completed_means_finished ON exec.project_task IS
  'A task reported complete at 80% would make every project percentage above it wrong.';

ALTER TABLE exec.project_task
  ADD CONSTRAINT task_weight_is_positive CHECK (weight >= 0);

-- A task cannot be its own predecessor. Longer cycles are caught by the
-- scheduler, which refuses them with the path it found.
ALTER TABLE exec.project_task_dependency
  ADD CONSTRAINT task_is_not_its_own_predecessor CHECK (task_id <> predecessor_id);
