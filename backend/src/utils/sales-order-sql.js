'use strict';

function paidSalesOrder(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Invalid sales order SQL alias');
  return `(${alias}.channel <> 'website' OR EXISTS (
    SELECT 1 FROM ecommerce_order_details e
     WHERE e.sales_order_id = ${alias}.id AND e.payment_status = 'paid'
  ))`;
}

module.exports = { paidSalesOrder };
