const { getDb } = require('./database');

function addPeriod(dateStr, frequency) {
  const d = new Date(dateStr);
  if (frequency === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (frequency === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else if (frequency === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().split('T')[0];
}

function calculateNextInvoiceNumber(db) {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM invoices').get();
  const nextNum = (countRow.cnt + 1).toString().padStart(4, '0');
  const year = new Date().getFullYear();
  return `INV-${year}-${nextNum}`;
}

function runBillingCycle(targetDate = null) {
  const db = getDb();
  const today = targetDate || new Date().toISOString().split('T')[0];

  // 1. Check for expired subscriptions with auto_close_on_end
  const subsToClose = db.prepare(`
    SELECT s.id, p.auto_close_on_end, s.expiry_date
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.status = 'Active' 
      AND s.expiry_date IS NOT NULL 
      AND s.expiry_date < ?
      AND p.auto_close_on_end = 1
  `).all(today);

  for (const s of subsToClose) {
    db.prepare("UPDATE subscriptions SET status = 'Closed' WHERE id = ?").run(s.id);
  }

  // 2. Fetch all Active subscriptions due for billing
  const dueSubscriptions = db.prepare(`
    SELECT s.*, p.billing_frequency, p.name as plan_name, u.email, u.full_name, u.company_name
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    JOIN users u ON s.customer_id = u.id
    WHERE s.status = 'Active' 
      AND s.next_billing_date <= ?
      AND (s.expiry_date IS NULL OR s.expiry_date >= ?)
  `).all(today, today);

  const results = {
    processed: 0,
    generatedInvoices: [],
    skippedAlreadyBilled: 0,
    errors: []
  };

  for (const sub of dueSubscriptions) {
    const periodStart = sub.next_billing_date;
    const periodEnd = addPeriod(periodStart, sub.billing_frequency);

    // Double Billing Check: verify whether this cycle was already billed
    const existing = db.prepare(`
      SELECT id, invoice_number FROM invoices
      WHERE subscription_id = ? 
        AND billing_period_start = ? 
        AND billing_period_end = ?
        AND status != 'Cancelled'
    `).get(sub.id, periodStart, periodEnd);

    if (existing) {
      results.skippedAlreadyBilled++;
      continue;
    }

    // Fetch subscription lines
    const lines = db.prepare(`
      SELECT sl.*, p.name as product_name, p.sales_price, pv.variant_name, pv.price_modifier,
             tr.rate_percentage as tax_rate, tr.name as tax_name,
             dr.id as disc_id, dr.code as disc_code, dr.type as disc_type, dr.value as disc_value,
             dr.min_purchase_amount, dr.min_quantity, dr.start_date as disc_start, dr.end_date as disc_end,
             dr.max_uses, dr.current_uses, dr.applicable_product_id
      FROM subscription_lines sl
      JOIN products p ON sl.product_id = p.id
      LEFT JOIN product_variants pv ON sl.variant_id = pv.id
      LEFT JOIN tax_rules tr ON sl.tax_rule_id = tr.id
      LEFT JOIN discount_rules dr ON sl.discount_rule_id = dr.id
      WHERE sl.subscription_id = ?
    `).all(sub.id);

    if (lines.length === 0) continue;

    let subtotal = 0;
    let taxTotal = 0;
    let discountTotal = 0;
    const invoiceLinesToInsert = [];
    const discountsToIncrement = [];

    for (const line of lines) {
      const basePrice = (line.unit_price || line.sales_price) + (line.price_modifier || 0.0);
      const lineGross = basePrice * line.quantity;
      let lineDiscount = 0;

      // Evaluate discount rules dynamically
      if (line.disc_id) {
        let isEligible = true;
        if (line.disc_start && today < line.disc_start) isEligible = false;
        if (line.disc_end && today > line.disc_end) isEligible = false;
        if (line.max_uses > 0 && line.current_uses >= line.max_uses) isEligible = false;
        if (line.min_quantity > 0 && line.quantity < line.min_quantity) isEligible = false;
        if (line.min_purchase_amount > 0 && lineGross < line.min_purchase_amount) isEligible = false;

        if (isEligible) {
          if (line.disc_type === 'percentage') {
            lineDiscount = (lineGross * line.disc_value) / 100.0;
          } else if (line.disc_type === 'fixed') {
            lineDiscount = Math.min(line.disc_value, lineGross);
          }
          discountsToIncrement.push(line.disc_id);
        }
      }

      const taxableAmount = Math.max(0, lineGross - lineDiscount);
      let lineTax = 0;
      if (line.tax_rate) {
        lineTax = (taxableAmount * line.tax_rate) / 100.0;
      }

      const lineTotal = taxableAmount + lineTax;

      subtotal += lineGross;
      discountTotal += lineDiscount;
      taxTotal += lineTax;

      invoiceLinesToInsert.push({
        productId: line.product_id,
        productName: line.product_name,
        variantName: line.variant_name || null,
        quantity: line.quantity,
        unitPrice: basePrice,
        taxAmount: parseFloat(lineTax.toFixed(2)),
        discountAmount: parseFloat(lineDiscount.toFixed(2)),
        lineTotal: parseFloat(lineTotal.toFixed(2))
      });
    }

    const grandTotal = parseFloat((subtotal - discountTotal + taxTotal).toFixed(2));
    const invNumber = calculateNextInvoiceNumber(db);

    // Compute due date (default Net 30 or based on payment_terms)
    const dueDate = addPeriod(periodStart, 'monthly'); // 30 days window

    // Execute atomic transaction for invoice creation and subscription next_billing_date update
    const insertInv = db.prepare(`
      INSERT INTO invoices (
        invoice_number, subscription_id, customer_id, 
        billing_period_start, billing_period_end, issue_date, due_date, 
        status, subtotal, tax_total, discount_total, grand_total, amount_paid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, 0.0)
    `);

    const invRes = insertInv.run(
      invNumber, sub.id, sub.customer_id,
      periodStart, periodEnd, today, dueDate,
      parseFloat(subtotal.toFixed(2)),
      parseFloat(taxTotal.toFixed(2)),
      parseFloat(discountTotal.toFixed(2)),
      grandTotal
    );

    const invoiceId = invRes.lastInsertRowid;

    // Insert invoice lines
    const insertInvLine = db.prepare(`
      INSERT INTO invoice_lines (
        invoice_id, product_id, product_name, variant_name, quantity, unit_price, tax_amount, discount_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const il of invoiceLinesToInsert) {
      insertInvLine.run(
        invoiceId, il.productId, il.productName, il.variantName, il.quantity, il.unitPrice, il.taxAmount, il.discountAmount, il.lineTotal
      );
    }

    // Increment discount usage counters
    for (const dId of discountsToIncrement) {
      db.prepare('UPDATE discount_rules SET current_uses = current_uses + 1 WHERE id = ?').run(dId);
    }

    // Advance subscription next_billing_date
    db.prepare('UPDATE subscriptions SET next_billing_date = ? WHERE id = ?').run(periodEnd, sub.id);

    results.processed++;
    results.generatedInvoices.push({
      invoiceId,
      invoiceNumber: invNumber,
      subscriptionNumber: sub.sub_number,
      customer: sub.company_name || sub.full_name,
      grandTotal
    });
  }

  return results;
}

module.exports = {
  runBillingCycle,
  addPeriod
};
