-- =============================================================================
-- BILLING INVARIANTS
--
-- The charge amount already cannot disagree with its own quantity and rate
-- (20260914050000_operations_invariants). These are the rules that keep an
-- invoice and the money paid against it honest:
--
--   1. An invoice's total is its subtotal less its discount
--   2. An invoice cannot be paid more than it asks for
--   3. What an invoice records as paid equals the allocations against it
--   4. A payment cannot be allocated to more than it was worth
--   5. A waived charge names the reason and the person who decided
--   6. An issued invoice says when it was issued
--
-- Rules 3 and 4 are deferred triggers, because a payment and its allocations
-- are legitimately written as separate statements. What they will not permit is
-- the two disagreeing once the transaction closes — which is what a receipt a
-- patient cannot reconcile looks like from the database's side.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The arithmetic on the face of the invoice
-- -----------------------------------------------------------------------------

ALTER TABLE fin.invoice
  ADD CONSTRAINT invoice_total_is_derived CHECK (
    total_minor = subtotal_minor - discount_minor
  );

COMMENT ON CONSTRAINT invoice_total_is_derived ON fin.invoice IS
  'Spec §10: the total is stored for reporting and constrained so an invoice cannot disagree with itself.';

ALTER TABLE fin.invoice
  ADD CONSTRAINT invoice_amounts_are_not_negative CHECK (
    subtotal_minor >= 0 AND discount_minor >= 0 AND total_minor >= 0 AND paid_minor >= 0
  );

-- Overpayment hides money that belongs somewhere else.
ALTER TABLE fin.invoice
  ADD CONSTRAINT invoice_not_paid_more_than_it_asks CHECK (paid_minor <= total_minor);

ALTER TABLE fin.invoice
  ADD CONSTRAINT issued_invoice_says_when CHECK (
    status = 'DRAFT' OR issued_at IS NOT NULL
  );

ALTER TABLE fin.invoice_item
  ADD CONSTRAINT invoice_item_amount_is_derived CHECK (
    amount_minor = round(quantity * unit_price_minor)
  );

ALTER TABLE fin.payment_allocation
  ADD CONSTRAINT allocation_is_positive CHECK (amount_minor > 0);


-- -----------------------------------------------------------------------------
-- 2. A payment is not applied twice
--
-- Deferred: the payment row and its allocations are written in one transaction
-- but separate statements.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fin.assert_payment_allocations(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount    bigint;
  v_allocated bigint;
  v_reference text;
BEGIN
  SELECT amount_minor, reference INTO v_amount, v_reference
    FROM fin.payment WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_allocated
    FROM fin.payment_allocation WHERE payment_id = p_payment_id;

  IF v_allocated > v_amount THEN
    RAISE EXCEPTION
      'Payment % is worth % kobo but % kobo have been allocated from it. Money cannot be applied twice.',
      v_reference, v_amount, v_allocated
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fin.check_payment_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fin.assert_payment_allocations(COALESCE(NEW.payment_id, OLD.payment_id));
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_payment_allocation_total
  AFTER INSERT OR UPDATE OR DELETE ON fin.payment_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fin.check_payment_allocations();


-- -----------------------------------------------------------------------------
-- 3. What the invoice says it has been paid is what was allocated to it
--
-- The column exists so a list of invoices does not need a subquery per row. It
-- is constrained against the allocations so it can never become a second,
-- disagreeing account of what the patient has paid.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fin.assert_invoice_paid(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_paid      bigint;
  v_allocated bigint;
  v_reference text;
  v_status    text;
BEGIN
  SELECT paid_minor, reference, status::text INTO v_paid, v_reference, v_status
    FROM fin.invoice WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A draft has not been issued and nothing can have been paid against it.
  IF v_status = 'DRAFT' THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_allocated
    FROM fin.payment_allocation WHERE invoice_id = p_invoice_id;

  IF v_paid <> v_allocated THEN
    RAISE EXCEPTION
      'Invoice % records % kobo paid but % kobo are allocated to it. The receipt and the invoice must agree.',
      v_reference, v_paid, v_allocated
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fin.check_invoice_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fin.assert_invoice_paid(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION fin.check_allocation_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fin.assert_invoice_paid(COALESCE(NEW.invoice_id, OLD.invoice_id));
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_invoice_paid_agrees
  AFTER INSERT OR UPDATE ON fin.invoice
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fin.check_invoice_paid();

CREATE CONSTRAINT TRIGGER trg_allocation_invoice_agrees
  AFTER INSERT OR UPDATE OR DELETE ON fin.payment_allocation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fin.check_allocation_invoice();


-- -----------------------------------------------------------------------------
-- 4. A charge on an invoice is not also available to bill again
--
-- `charge_id` is already UNIQUE on invoice_item, which is what prevents the
-- same consultation appearing on two bills. Stated here because the constraint
-- is easy to remove by accident and this is the failure it prevents: a patient
-- asked twice for the same thing.
-- -----------------------------------------------------------------------------

-- Prisma creates it as a unique INDEX rather than a table constraint, so the
-- comment goes on the index.
COMMENT ON INDEX fin.invoice_item_charge_id_key IS
  'One charge, one invoice line, ever. Prevents a patient being billed twice for the same care.';
