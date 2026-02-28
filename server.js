const path = require('path');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const db = new sqlite3.Database(path.join(__dirname, 'wms.db'));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function addHistory(orderId, action, details) {
  await run(
    `INSERT INTO order_history (orderId, action, details, timestamp)
     VALUES (?, ?, ?, ?)`,
    [orderId, action, details || null, new Date().toISOString()]
  );
}

async function getOrderWithItems(orderId) {
  const order = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) {
    return null;
  }

  const items = await all(
    `SELECT orderId, itemId, requiredQuantity, pickedQuantity
     FROM order_items
     WHERE orderId = ?`,
    [orderId]
  );

  return { ...order, t34Passport: Boolean(order.t34Passport), items };
}

async function getAllOrdersWithItems() {
  const orders = await all('SELECT * FROM orders ORDER BY date DESC');
  const items = await all(
    `SELECT orderId, itemId, requiredQuantity, pickedQuantity
     FROM order_items`
  );

  const itemsByOrder = items.reduce((acc, item) => {
    if (!acc[item.orderId]) {
      acc[item.orderId] = [];
    }
    acc[item.orderId].push(item);
    return acc;
  }, {});

  return orders.map((order) => ({
    ...order,
    t34Passport: Boolean(order.t34Passport),
    items: itemsByOrder[order.id] || []
  }));
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS warehouse (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    category TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer TEXT NOT NULL,
    date TEXT NOT NULL,
    assemblyLocation TEXT,
    status TEXT NOT NULL,
    note TEXT,
    t34Passport INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_items (
    orderId TEXT,
    itemId TEXT,
    requiredQuantity INTEGER NOT NULL,
    pickedQuantity INTEGER NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (itemId) REFERENCES warehouse(id),
    PRIMARY KEY (orderId, itemId)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    timestamp TEXT NOT NULL
  )`);
}

app.get('/api/warehouse', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    let rows;

    if (search) {
      const likeSearch = `%${search}%`;
      rows = await all(
        `SELECT id, name, quantity, category
         FROM warehouse
         WHERE id LIKE ? OR name LIKE ? OR category LIKE ?
         ORDER BY name ASC`,
        [likeSearch, likeSearch, likeSearch]
      );
    } else {
      rows = await all(
        `SELECT id, name, quantity, category
         FROM warehouse
         ORDER BY name ASC`
      );
    }

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch warehouse items' });
  }
});

app.post('/api/warehouse', async (req, res) => {
  try {
    const { id, name, quantity, category } = req.body;

    if (!id || !name || !Number.isInteger(quantity)) {
      res.status(400).json({ error: 'id, name and integer quantity are required' });
      return;
    }

    await run(
      `INSERT INTO warehouse (id, name, quantity, category)
       VALUES (?, ?, ?, ?)`,
      [id, name, quantity, category || null]
    );

    const created = await get('SELECT * FROM warehouse WHERE id = ?', [id]);
    res.status(201).json(created);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create warehouse item' });
  }
});

app.put('/api/warehouse/:id', async (req, res) => {
  try {
    const { quantity } = req.body;
    const { id } = req.params;

    if (!Number.isInteger(quantity)) {
      res.status(400).json({ error: 'integer quantity is required' });
      return;
    }

    const result = await run('UPDATE warehouse SET quantity = ? WHERE id = ?', [quantity, id]);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const updated = await get('SELECT * FROM warehouse WHERE id = ?', [id]);
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update warehouse item' });
  }
});

app.delete('/api/warehouse/:id', async (req, res) => {
  try {
    const result = await run('DELETE FROM warehouse WHERE id = ?', [req.params.id]);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete warehouse item' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getAllOrdersWithItems();
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const {
      id,
      customer,
      date,
      assemblyLocation,
      status,
      note,
      t34Passport,
      items = []
    } = req.body;

    if (!id || !customer || !date || !status || typeof t34Passport !== 'boolean' || !Array.isArray(items)) {
      res.status(400).json({ error: 'Invalid order payload' });
      return;
    }

    await run('BEGIN TRANSACTION');

    try {
      await run(
        `INSERT INTO orders (id, customer, date, assemblyLocation, status, note, t34Passport)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, customer, date, assemblyLocation || null, status, note || null, t34Passport ? 1 : 0]
      );

      for (const item of items) {
        if (
          !item.itemId
          || !Number.isInteger(item.requiredQuantity)
          || !Number.isInteger(item.pickedQuantity)
        ) {
          throw new Error('Invalid item payload');
        }

        await run(
          `INSERT INTO order_items (orderId, itemId, requiredQuantity, pickedQuantity)
           VALUES (?, ?, ?, ?)`,
          [id, item.itemId, item.requiredQuantity, item.pickedQuantity]
        );
      }

      await addHistory(id, 'ORDER_CREATED', `Order created for customer ${customer}`);
      await run('COMMIT');
    } catch (txError) {
      await run('ROLLBACK');
      throw txError;
    }

    const created = await getOrderWithItems(id);
    res.status(201).json(created);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const current = await getOrderWithItems(id);

    if (!current) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const {
      customer,
      date,
      assemblyLocation,
      status,
      note,
      t34Passport,
      items = []
    } = req.body;

    if (
      !customer
      || !date
      || !status
      || typeof t34Passport !== 'boolean'
      || !Array.isArray(items)
    ) {
      res.status(400).json({ error: 'Invalid order payload' });
      return;
    }

    await run('BEGIN TRANSACTION');

    try {
      await run(
        `UPDATE orders
         SET customer = ?, date = ?, assemblyLocation = ?, status = ?, note = ?, t34Passport = ?
         WHERE id = ?`,
        [customer, date, assemblyLocation || null, status, note || null, t34Passport ? 1 : 0, id]
      );

      await run('DELETE FROM order_items WHERE orderId = ?', [id]);

      for (const item of items) {
        if (
          !item.itemId
          || !Number.isInteger(item.requiredQuantity)
          || !Number.isInteger(item.pickedQuantity)
        ) {
          throw new Error('Invalid item payload');
        }

        await run(
          `INSERT INTO order_items (orderId, itemId, requiredQuantity, pickedQuantity)
           VALUES (?, ?, ?, ?)`,
          [id, item.itemId, item.requiredQuantity, item.pickedQuantity]
        );
      }

      if (current.customer !== customer) {
        await addHistory(id, 'CUSTOMER_CHANGED', `${current.customer} -> ${customer}`);
      }

      if (current.status !== status) {
        await addHistory(id, 'STATUS_CHANGED', `${current.status} -> ${status}`);
      }

      const oldItems = JSON.stringify(current.items);
      const newItems = JSON.stringify(items);
      if (oldItems !== newItems) {
        await addHistory(id, 'ITEMS_CHANGED', 'Order composition changed');
      }

      await addHistory(id, 'ORDER_UPDATED', 'Order details updated');
      await run('COMMIT');
    } catch (txError) {
      await run('ROLLBACK');
      throw txError;
    }

    const updated = await getOrderWithItems(id);
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

app.put('/api/orders/:id/items/:itemId/pick', async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { pickedQuantity } = req.body;

    if (!Number.isInteger(pickedQuantity) || pickedQuantity < 0) {
      res.status(400).json({ error: 'pickedQuantity must be a non-negative integer' });
      return;
    }

    const existing = await get(
      `SELECT requiredQuantity, pickedQuantity
       FROM order_items
       WHERE orderId = ? AND itemId = ?`,
      [id, itemId]
    );

    if (!existing) {
      res.status(404).json({ error: 'Order item not found' });
      return;
    }

    await run(
      `UPDATE order_items
       SET pickedQuantity = ?
       WHERE orderId = ? AND itemId = ?`,
      [pickedQuantity, id, itemId]
    );

    await addHistory(
      id,
      'PICKING_UPDATED',
      `Item ${itemId}: ${existing.pickedQuantity} -> ${pickedQuantity} of ${existing.requiredQuantity}`
    );

    const updated = await getOrderWithItems(id);
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update picking quantity' });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const existing = await get('SELECT id FROM orders WHERE id = ?', [req.params.id]);

    if (!existing) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    await run('BEGIN TRANSACTION');

    try {
      await run('DELETE FROM order_items WHERE orderId = ?', [req.params.id]);
      await run('DELETE FROM orders WHERE id = ?', [req.params.id]);
      await addHistory(req.params.id, 'ORDER_DELETED', 'Order deleted');
      await run('COMMIT');
    } catch (txError) {
      await run('ROLLBACK');
      throw txError;
    }

    res.json({ message: 'Order deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

app.get('/api/orders/:id/history', async (req, res) => {
  try {
    const history = await all(
      `SELECT id, orderId, action, details, timestamp
       FROM order_history
       WHERE orderId = ?
       ORDER BY id DESC`,
      [req.params.id]
    );

    res.json(history);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch order history' });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`WMS server running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
