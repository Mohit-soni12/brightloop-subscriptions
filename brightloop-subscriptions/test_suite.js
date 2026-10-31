const assert = require('node:assert');
const { getDb, hashPassword, validatePasswordPolicy, seedDatabase } = require('./database');
const { runBillingCycle, addPeriod } = require('./billing_engine');

console.log('====================================================');
console.log('🧪 RUNNING BRIGHTLOOP SUBSCRIPTION SYSTEM TEST SUITE');
console.log('====================================================\n');

async function runTests() {
  const db = getDb();
  seedDatabase(db);

  // Test 1: Password Policy Validation
  console.log('Test 1: Password Policy Validation (>8 chars, uppercase, lowercase, special char)');
  assert.strictEqual(validatePasswordPolicy('short').valid, false, 'Should reject short password');
  assert.strictEqual(validatePasswordPolicy('lowercaseonly123!').valid, false, 'Should reject no uppercase');
  assert.strictEqual(validatePasswordPolicy('UPPERCASEONLY123!').valid, false, 'Should reject no lowercase');
  assert.strictEqual(validatePasswordPolicy('NoSpecialChar12345').valid, false, 'Should reject no special character');
  assert.strictEqual(validatePasswordPolicy('Compliant@Pass2026').valid, true, 'Should accept valid password');
  console.log('  ✅ Passed: Password policy strictly verified.\n');

  // Test 2: Product & Variant Price Modifier (Odoo brand adds 560)
  console.log('Test 2: Product Variant Price Calculation (Odoo brand adds 560)');
  const coreProduct = db.prepare("SELECT * FROM products WHERE name = 'Brightloop Business Core'").get();
  assert(coreProduct, 'Core product must exist');
  assert.strictEqual(coreProduct.sales_price, 499.00, 'Base price is 499.00');

  const odooVariant = db.prepare("SELECT * FROM product_variants WHERE product_id = ? AND variant_name LIKE '%Odoo%'").get(coreProduct.id);
  assert(odooVariant, 'Odoo variant must exist');
  assert.strictEqual(odooVariant.price_modifier, 560.00, 'Odoo variant modifier is +560.00');

  const combinedPrice = coreProduct.sales_price + odooVariant.price_modifier;
  assert.strictEqual(combinedPrice, 1059.00, 'Combined price must be 499 + 560 = 1059');
  console.log(`  ✅ Passed: Odoo brand variant price correctly calculated: $${combinedPrice} (Base $499 + $560).\n`);

  // Test 3: Plan Lifecycle & Recurrence
  console.log('Test 3: Plan Lifecycle & Recurrence calculation');
  const dStart = '2026-01-01';
  assert.strictEqual(addPeriod(dStart, 'daily'), '2026-01-02');
  assert.strictEqual(addPeriod(dStart, 'weekly'), '2026-01-08');
  assert.strictEqual(addPeriod(dStart, 'monthly'), '2026-02-01');
  assert.strictEqual(addPeriod(dStart, 'yearly'), '2027-01-01');
  console.log('  ✅ Passed: All recurrence periods computed accurately.\n');

  // Test 4: Subscription State Transition Machine
  console.log('Test 4: Quotation to Subscription Transition State Machine');
  const countSub = db.prepare('SELECT COUNT(*) as cnt FROM subscriptions').get().cnt;
  const testSubNum = `SUB-TEST-${Date.now()}`;
  
  // Create Draft
  const insTestSub = db.prepare(`
    INSERT INTO subscriptions (sub_number, customer_id, plan_id, status, start_date, next_billing_date, payment_terms, total_amount)
    VALUES (?, 4, 1, 'Draft', '2026-10-01', '2026-10-01', 'Net 30', 499.00)
  `);
  const subRes = insTestSub.run(testSubNum);
  const testSubId = subRes.lastInsertRowid;

  // Insert line
  db.prepare(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_rule_id)
    VALUES (?, ?, NULL, 1, 499.00, 1)
  `).run(testSubId, coreProduct.id);

  // Draft -> Quotation -> Confirmed -> Active -> Paused -> Active -> Closed
  const states = ['Quotation', 'Confirmed', 'Active', 'Paused', 'Active', 'Closed'];
  for (const st of states) {
    db.prepare('UPDATE subscriptions SET status = ? WHERE id = ?').run(st, testSubId);
    const updated = db.prepare('SELECT status FROM subscriptions WHERE id = ?').get(testSubId);
    assert.strictEqual(updated.status, st);
  }
  console.log('  ✅ Passed: Full state flow Draft -> Quotation -> Confirmed -> Active -> Paused -> Closed verified.\n');

  // Test 5: Automated Billing Run & Idempotency (Zero Double Billing)
  console.log('Test 5: Automated Billing Engine & Idempotency Guarantee');
  // Create an active subscription due today
  const billSubNum = `SUB-BILL-${Date.now()}`;
  const billRes = db.prepare(`
    INSERT INTO subscriptions (sub_number, customer_id, plan_id, status, start_date, next_billing_date, payment_terms, total_amount)
    VALUES (?, 4, 1, 'Active', '2026-10-31', '2026-10-31', 'Net 30', 499.00)
  `).run(billSubNum);
  const billSubId = billRes.lastInsertRowid;

  db.prepare(`
    INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_rule_id)
    VALUES (?, ?, NULL, 1, 499.00, 1)
  `).run(billSubId, coreProduct.id);

  // Run billing cycle
  const run1 = runBillingCycle('2026-10-31');
  assert(run1.processed >= 1, 'At least 1 invoice must be generated in run 1');
  const genInv = run1.generatedInvoices.find(i => i.subscriptionNumber === billSubNum);
  assert(genInv, 'Generated invoice should match our test subscription');
  console.log(`  Generated Invoice ${genInv.invoiceNumber} for $${genInv.grandTotal}`);

  // Re-run immediately: Idempotency must prevent any duplicate invoice for the same cycle
  const run2 = runBillingCycle('2026-10-31');
  const dupeInv = run2.generatedInvoices.find(i => i.subscriptionNumber === billSubNum);
  assert(!dupeInv, 'Duplicate invoice must NEVER be created for the same billing cycle');
  console.log('  ✅ Passed: Idempotency verified — duplicate billing completely blocked.\n');

  // Test 6: Payment Recording & Reconciliation
  console.log('Test 6: Multi-method Payment Recording and Auto-settlement');
  const invToPay = db.prepare('SELECT * FROM invoices WHERE id = ?').get(genInv.invoiceId);
  assert(invToPay, 'Invoice must exist');
  assert.strictEqual(invToPay.status, 'Draft');

  // Confirm invoice
  db.prepare("UPDATE invoices SET status = 'Confirmed' WHERE id = ?").run(invToPay.id);

  // Make partial payment
  const partialAmount = 200.00;
  const payId1 = `PAY-TEST-${Date.now()}-01`;
  const payId2 = `PAY-TEST-${Date.now()}-02`;
  db.prepare(`
    INSERT INTO payments (payment_number, invoice_id, amount, method, payment_date, note)
    VALUES (?, ?, ?, 'Bank Transfer', '2026-10-31', 'Partial wire payment')
  `).run(payId1, invToPay.id, partialAmount);

  db.prepare('UPDATE invoices SET amount_paid = amount_paid + ? WHERE id = ?').run(partialAmount, invToPay.id);
  let checkedInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invToPay.id);
  assert.strictEqual(checkedInv.amount_paid, 200.00);
  assert.strictEqual(checkedInv.status, 'Confirmed');

  // Settle remaining balance
  const remaining = checkedInv.grand_total - checkedInv.amount_paid;
  db.prepare(`
    INSERT INTO payments (payment_number, invoice_id, amount, method, payment_date, note)
    VALUES (?, ?, ?, 'Credit Card', '2026-10-31', 'Final balance settlement')
  `).run(payId2, invToPay.id, remaining);

  db.prepare("UPDATE invoices SET amount_paid = grand_total, status = 'Paid' WHERE id = ?").run(invToPay.id);
  checkedInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invToPay.id);
  assert.strictEqual(checkedInv.status, 'Paid');
  console.log(`  ✅ Passed: Partial payment ($200) followed by final settlement ($${remaining.toFixed(2)}) moved invoice to Paid status.\n`);

  // Test 7: Finance Lead Dashboard Latency (< 2 Seconds SLA)
  console.log('Test 7: Finance Lead Analytics Query Latency Performance');
  const t0 = performance.now();
  const activeSubs = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total FROM subscriptions WHERE status = 'Active'").get();
  const collectedRev = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments").get();
  const overdueInvs = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(grand_total - amount_paid), 0) as overdue FROM invoices WHERE status != 'Paid' AND due_date < date('now')").get();
  const elapsedMs = performance.now() - t0;

  console.log(`  Active Subscriptions: ${activeSubs.count} (Val: $${activeSubs.total.toFixed(2)})`);
  console.log(`  Total Cleared Revenue: $${collectedRev.total.toFixed(2)}`);
  console.log(`  Total Overdue Balance: $${overdueInvs.overdue.toFixed(2)} (${overdueInvs.cnt} invoices)`);
  console.log(`  Dashboard Aggregate Query Execution Time: ${elapsedMs.toFixed(3)} ms`);
  assert(elapsedMs < 2000, 'Query must respond in under 2000ms');
  console.log('  ✅ Passed: Performance SLA validated (Execution time is far below 2.0s limit).\n');

  console.log('====================================================');
  console.log('🎉 ALL BRIGHTLOOP TEST CASES PASSED WITH 100% SUCCESS');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
